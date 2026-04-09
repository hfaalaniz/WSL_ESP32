/**
 * WslScriptEditor.jsx — Editor Avanzado WSL
 * 
 * Características:
 * - Validación sintáctica en tiempo real
 * - Autocompletado inteligente
 * - Debugging con breakpoints
 * - Inspector de variables
 * - Console con output
 * - Ejecución paso a paso
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { WslParser } from '../../engine/WslParser.js';
import { WslLexer, TT } from '../../engine/WslLexer.js';
import { WslParseError } from '../../engine/WslErrors.js';
import { WslRuntime } from '../../engine/WslRuntime.js';

// ─── Validador WSL ───────────────────────────────────────────────────────────

class WslValidator {
  constructor(code) {
    this.code = code;
    this.errors = [];
    this.warnings = [];
    this.ast = null;
  }

  validate() {
    try {
      this.ast = new WslParser(this.code).parse();
      this.errors = [];
      this._validateSemantics();
    } catch (e) {
      if (e instanceof WslParseError) {
        // El parser adjunta todos los errores en e.allErrors cuando usa error recovery
        const allErrors = e.allErrors ?? [e];
        this.errors = allErrors.map(err => ({
          message: err.wslMessage || err.message,
          line:     err.line   ?? 1,
          column:   err.col    ?? 1,
          severity: 'error',
        }));
      } else {
        // Eliminar prefijo "[WSL ...]" si existiese
        const msg = e.message?.replace(/^\[WSL \w+\]\s*Línea \d+:\d+\s*—\s*/, '') ?? e.message;
        this.errors = [{
          message:  msg,
          line:     e.line ?? 1,
          column:   e.col  ?? 1,
          severity: 'error',
        }];
      }
      this.ast = null;
    }
    return { ast: this.ast, errors: this.errors, warnings: this.warnings };
  }

  _validateSemantics() {
    if (!this.ast) return;
    // (espacio para futuras validaciones semánticas)
  }
}

// ─── Componente Editor ───────────────────────────────────────────────────────

export default function WslScriptEditor({
  script = '',
  onChange,
  tags = [],
  scadaObjects = [],
  hardware = null,
  onExecute,
  onDebugStep
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const containerRef = useRef(null);
  const [code, setCode] = useState(script);
  const [validation, setValidation] = useState({ ast: null, errors: [], warnings: [] });
  const [markers, setMarkers] = useState([]);
  
  // Estado de debugging
  const [debugMode, setDebugMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [breakpoints, setBreakpoints] = useState(new Set());
  const [currentLine, setCurrentLine] = useState(null);
  const [variables, setVariables] = useState({});
  const [logs, setLogs] = useState([]);
  const [runtime, setRuntime] = useState(null);

  // Validar código
  const validateCode = useCallback((source) => {
    const validator = new WslValidator(source);
    const result = validator.validate();
    
    // Convertir errores a markers de Monaco
    const monacoMarkers = [
      ...result.errors.map(e => ({
        severity: 'error',
        startLineNumber: e.line,
        startColumn: e.column,
        endLineNumber: e.line,
        endColumn: e.column + 1,
        message: e.message,
      })),
      ...result.warnings.map(w => ({
        severity: 'warning',
        startLineNumber: w.line,
        startColumn: w.column,
        endLineNumber: w.line,
        endColumn: w.column + 1,
        message: w.message,
      })),
    ];

    setValidation(result);
    setMarkers(monacoMarkers);
    
    return result;
  }, []);

  // Manejar cambios de código
  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    onChange?.(newCode);
    validateCode(newCode);
  }, [onChange, validateCode]);

  // Registrar lenguaje y autocompletado antes de crear el editor
  const handleEditorWillMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    registerWslLanguage(monaco);
    registerWslCompletion(monaco, tags, scadaObjects);
    registerWslCodeActions(monaco);
  }, [tags, scadaObjects]);

  // Re-registrar autocompletado cuando cambian los objetos SCADA o los tags
  useEffect(() => {
    if (!monacoRef.current) return;
    registerWslCompletion(monacoRef.current, tags, scadaObjects);
  }, [tags, scadaObjects]);

  // Montar editor + ResizeObserver para forzar layout correcto
  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    try {
      if (editor.getModel()) {
        monaco.editor.setModelLanguage(editor.getModel(), 'wsl');
      }
      validateCode(code);

      // ResizeObserver: recalcula dimensiones cuando el contenedor cambia
      if (containerRef.current) {
        const ro = new ResizeObserver(() => {
          editor.layout();
        });
        ro.observe(containerRef.current);
        // Forzar layout inicial después de que el DOM se estabilice
        setTimeout(() => editor.layout(), 50);
      }
    } catch (error) {
      console.error('Error initializing WSL editor:', error);
    }
  }, [code, validateCode]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    const severityMap = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
      hint: monaco.MarkerSeverity.Hint,
    };

    const monacoMarkers = markers.map(marker => ({
      ...marker,
      severity: severityMap[marker.severity] ?? monaco.MarkerSeverity.Info,
    }));

    monaco.editor.setModelMarkers(model, 'wslScript', monacoMarkers);
    editor.layout();
  }, [markers]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handleResize = () => editor.layout();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Toggle breakpoint al hacer click en el gutter
  const handleGutterClick = useCallback((lineNumber) => {
    const newBreakpoints = new Set(breakpoints);
    if (newBreakpoints.has(lineNumber)) {
      newBreakpoints.delete(lineNumber);
    } else {
      newBreakpoints.add(lineNumber);
    }
    setBreakpoints(newBreakpoints);
  }, [breakpoints]);

  // Ejecutar script
  const handleExecute = useCallback(async () => {
    if (!validation.ast) {
      alert('Hay errores de sintaxis. Corrige el código primero.');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setVariables({});

    try {
      const rt = new WslRuntime({
        hardware: hardware || { device: { id: 'test' }, tags: tags.reduce((acc, t) => ({ ...acc, [t]: 0 }), {}) },
        script: code,
      });

      const syncVars = () => {
        if (typeof rt.getVariables === 'function') {
          setVariables(rt.getVariables());
        }
      };

      rt.onLog = ({ ts, msg }) => {
        setLogs(prev => [...prev.slice(-99), { ts, msg, type: 'log' }]);
        syncVars();
      };

      rt.onAlarm = ({ message, level, ts }) => {
        setLogs(prev => [...prev.slice(-99), { ts, msg: `[${level}] ${message}`, type: 'alarm' }]);
        syncVars();
      };

      rt.onTagChange = (tag, value) => {
        setVariables(prev => ({ ...prev, [tag]: value }));
      };

      setRuntime(rt);
      await rt.start();
      syncVars();
    } catch (error) {
      setLogs(prev => [...prev, { ts: new Date(), msg: `❌ ${error.message}`, type: 'error' }]);
    } finally {
      setIsRunning(false);
    }
  }, [code, validation.ast, hardware, tags]);

  // Detener ejecución
  const handleStop = useCallback(async () => {
    if (runtime) {
      await runtime.stop();
      setRuntime(null);
    }
    setIsRunning(false);
  }, [runtime]);

  // Hot-reload: envía el AST al ESP32 via POST /api/script
  const [uploadState, setUploadState] = useState('idle'); // 'idle'|'uploading'|'ok'|'error'
  const [uploadMsg,   setUploadMsg]   = useState('');

  const handleUploadScript = useCallback(async () => {
    if (!validation.ast || validation.errors.length > 0) {
      setUploadState('error');
      setUploadMsg('Corrige los errores de sintaxis primero');
      return;
    }

    const hw = hardware;
    const mode = hw?.device?.mode || 'SIMULATION';

    if (mode === 'SIMULATION') {
      setUploadState('error');
      setUploadMsg('Configura hardware con IP o puerto serial primero');
      return;
    }

    setUploadState('uploading');
    setUploadMsg('');

    const astJson = JSON.stringify(validation.ast);

    try {
      if (mode === 'REMOTE' || mode === 'AUTO') {
        const ip   = hw.device.connection.remote.ip;
        const port = hw.device.connection.remote.port || 80;
        const res  = await fetch(`http://${ip}:${port}/api/script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: astJson,
        });
        const data = await res.json();
        if (data.ok) {
          setUploadState('ok');
          setUploadMsg(data.msg || 'Script recargado');
        } else {
          setUploadState('error');
          setUploadMsg(data.msg || 'Error en el ESP32');
        }
      } else if (mode === 'LOCAL') {
        // Web Serial API
        if (!navigator.serial) {
          setUploadState('error');
          setUploadMsg('Web Serial no soportado en este navegador');
          return;
        }
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: hw.device.connection.local.baud || 115200 });
        const writer = port.writable.getWriter();
        const cmd = JSON.stringify({ cmd: 'LOAD_SCRIPT', ast: validation.ast }) + '\n';
        await writer.write(new TextEncoder().encode(cmd));
        writer.releaseLock();
        await port.close();
        setUploadState('ok');
        setUploadMsg('Script enviado por Serial');
      }
    } catch (err) {
      setUploadState('error');
      setUploadMsg(err.message);
    }

    setTimeout(() => { setUploadState('idle'); setUploadMsg(''); }, 4000);
  }, [validation, hardware]);

  return (
    <div style={s.root}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#38bdf8' }}>⚙ WSL Script Editor</span>
        </div>

        <div style={s.toolbarRight}>
          {/* Validación */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {validation.errors.length > 0 && (
              <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                ❌ {validation.errors.length} error{validation.errors.length !== 1 ? 's' : ''}
              </span>
            )}
            {validation.warnings.length > 0 && (
              <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠ {validation.warnings.length} warning{validation.warnings.length !== 1 ? 's' : ''}
              </span>
            )}
            {validation.errors.length === 0 && validation.warnings.length === 0 && (
              <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                ✓ Válido
              </span>
            )}
          </div>

          {/* Botones de ejecución */}
          <button
            onClick={handleExecute}
            disabled={isRunning || validation.errors.length > 0}
            style={{
              ...s.btnPrimary,
              opacity: isRunning || validation.errors.length > 0 ? 0.5 : 1,
              cursor: isRunning || validation.errors.length > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ▶ Ejecutar
          </button>

          {isRunning && (
            <button onClick={handleStop} style={s.btnDanger}>
              ⏹ Detener
            </button>
          )}

          <button
            onClick={() => setDebugMode(!debugMode)}
            style={{
              ...s.btnSecondary,
              background: debugMode ? '#8b5cf6' : '#374151',
            }}
          >
            🐛 Debug {debugMode ? 'ON' : 'OFF'}
          </button>

          {/* Hot-reload al ESP32 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={handleUploadScript}
              disabled={uploadState === 'uploading' || validation.errors.length > 0}
              title="Enviar script al ESP32 sin recompilar (hot-reload)"
              style={{
                ...s.btnSecondary,
                background: uploadState === 'ok' ? '#16a34a' : uploadState === 'error' ? '#7f1d1d' : '#1e3a5f',
                border: `1px solid ${uploadState === 'ok' ? '#22c55e' : uploadState === 'error' ? '#ef4444' : '#3b82f6'}`,
                color: uploadState === 'ok' ? '#22c55e' : uploadState === 'error' ? '#ef4444' : '#60a5fa',
                opacity: uploadState === 'uploading' || validation.errors.length > 0 ? 0.5 : 1,
                cursor: uploadState === 'uploading' || validation.errors.length > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {uploadState === 'uploading' ? '⏳ Subiendo...' : uploadState === 'ok' ? '✓ Cargado' : '⬆ Hot-reload ESP32'}
            </button>
            {uploadMsg && (
              <span style={{ fontSize: 11, color: uploadState === 'error' ? '#ef4444' : '#22c55e', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {uploadMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={s.body}>
        {/* Editor */}
        <div ref={containerRef} style={s.editorContainer}>
          <Editor
            height="100%"
            width="100%"
            defaultLanguage="wsl"
            value={code}
            onChange={handleCodeChange}
            onMount={handleEditorMount}
            beforeMount={handleEditorWillMount}
            options={{
              theme: 'wsl-dark',
              fontSize: 13,
              fontFamily: "'Fira Code', 'Monaco', monospace",
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              renderLineHighlight: 'all',
              cursorBlinking: 'blink',
              cursorStyle: 'line',
              minimap: { enabled: false },
              wordWrap: 'on',
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              quickSuggestions: { other: true, comments: true, strings: true },
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnCommitCharacter: true,
            }}
          />
        </div>

        {/* Debug Panel */}
        {debugMode && (
          <div style={s.debugPanel}>
            <div style={s.debugSection}>
              <div style={s.debugTitle}>📋 Variables</div>
              <div style={s.debugContent}>
                {Object.keys(variables).length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 12 }}>Sin variables</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {Object.entries(variables).map(([name, value]) => (
                      <li key={name} style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 4 }}>
                        <span style={{ color: '#7dd3fc' }}>{name}</span>:{' '}
                        <span style={{ fontFamily: 'monospace' }}>{JSON.stringify(value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div style={s.debugSection}>
              <div style={s.debugTitle}>🖨 Console</div>
              <div style={s.debugContent}>
                {logs.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 12 }}>Sin mensajes</div>
                ) : (
                  <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace' }}>
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        style={{
                          color: log.type === 'error' ? '#ef4444' : log.type === 'alarm' ? '#f59e0b' : '#cbd5e1',
                          marginBottom: 2,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {log.msg}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Panel de errores / problemas ──────────────────────────────────── */}
      <ErrorPanel
        errors={validation.errors}
        warnings={validation.warnings}
        onGoTo={(line, col) => {
          const editor = editorRef.current;
          if (!editor) return;
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: col });
          editor.focus();
        }}
      />
    </div>
  );
}

// ─── Panel de errores y advertencias ─────────────────────────────────────────

function ErrorPanel({ errors, warnings, onGoTo }) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const hasIssues = errors.length > 0 || warnings.length > 0;

  // Combinar errores y warnings con tipo para renderizado uniforme
  const items = [
    ...errors.map(e => ({ ...e, kind: 'error' })),
    ...warnings.map(w => ({ ...w, kind: 'warning' })),
  ];

  const handleClick = (item, idx) => {
    setSelectedIdx(idx);
    onGoTo(item.line ?? 1, item.column ?? 1);
  };

  return (
    <div style={ep.root}>
      {/* Cabecera */}
      <div style={ep.header}>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#94a3b8', letterSpacing: 0.4 }}>
          PROBLEMAS
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {errors.length > 0 && (
            <span style={{ color: '#ef4444', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={ep.iconError}>✕</span>
              {errors.length} error{errors.length !== 1 ? 'es' : ''}
            </span>
          )}
          {warnings.length > 0 && (
            <span style={{ color: '#f59e0b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={ep.iconWarn}>⚠</span>
              {warnings.length} advertencia{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
          {!hasIssues && (
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓ Sin problemas</span>
          )}
        </div>
      </div>

      {/* Lista de items */}
      {hasIssues && (
        <div style={ep.list}>
          {items.map((item, idx) => {
            const isSelected = selectedIdx === idx;
            const isErr = item.kind === 'error';
            return (
              <button
                key={idx}
                onClick={() => handleClick(item, idx)}
                style={{
                  ...ep.item,
                  background: isSelected ? (isErr ? '#3f0f0f' : '#3f2a00') : 'transparent',
                  borderLeft: `3px solid ${isErr ? '#ef4444' : '#f59e0b'}`,
                }}
                title="Ir al error"
              >
                {/* Icono */}
                <span style={{ color: isErr ? '#ef4444' : '#f59e0b', fontSize: 14, flexShrink: 0 }}>
                  {isErr ? '✕' : '⚠'}
                </span>

                {/* Mensaje principal */}
                <span style={{ flex: 1, color: '#e2e8f0', fontSize: 12, textAlign: 'left', lineHeight: 1.4 }}>
                  {item.message}
                </span>

                {/* Posición */}
                <span style={ep.pos}>
                  Ln {item.line ?? '?'}, Col {item.column ?? '?'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ep = {
  root: {
    flexShrink: 0,
    borderTop: '1px solid #334155',
    background: '#0a1120',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 180,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 14px',
    background: '#0f172a',
    borderBottom: '1px solid #1e293b',
    flexShrink: 0,
    height: 30,
  },
  list: {
    overflowY: 'auto',
    flex: 1,
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    padding: '6px 14px',
    border: 'none',
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    fontFamily: "'Fira Code', 'Monaco', monospace",
    transition: 'background 0.1s',
    borderBottom: '1px solid #0f172a',
  },
  pos: {
    flexShrink: 0,
    fontSize: 11,
    color: '#475569',
    fontFamily: 'monospace',
    marginLeft: 8,
    alignSelf: 'center',
  },
  iconError: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: '50%',
    background: '#ef444422', fontSize: 10, fontWeight: 700,
  },
  iconWarn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: '50%',
    background: '#f59e0b22', fontSize: 10, fontWeight: 700,
  },
};

// ─── Bandera para evitar registración múltiple ────────────────────────────────
let isWslLanguageRegistered = false;

// ─── Registrar lenguaje WSL en Monaco ─────────────────────────────────────────

function registerWslLanguage(monaco) {
  // Evitar registración múltiple
  if (isWslLanguageRegistered) return;
  isWslLanguageRegistered = true;

  const WSL_KEYWORDS = [
    'ON', 'END', 'IF', 'THEN', 'ELSE', 'WHILE', 'DO', 'FOR', 'FROM', 'TO',
    'STARTUP', 'SHUTDOWN', 'INTERVAL', 'CHANGE', 'CLICK', 'ALARM',
    'AND', 'OR', 'NOT', 'TRUE', 'FALSE', 'VAR',
  ];

  const WSL_BUILTINS = ['SET', 'LOG', 'NOTIFY', 'CALL', 'WAIT', 'READ', 'MODE', 'DEVICE', 'NOW'];

  // Registrar lenguaje WSL
  if (!monaco.languages.getLanguages().find(lang => lang.id === 'wsl')) {
    monaco.languages.register({ id: 'wsl' });
  }

  monaco.languages.setMonarchTokensProvider('wsl', {
    ignoreCase: false,
    keywords: WSL_KEYWORDS,
    builtins: WSL_BUILTINS,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"[^"]*"/, 'string'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/[=!<>+\-*/]+/, 'operator'],
        [/[a-zA-Z_][a-zA-Z0-9_.]*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'type.identifier',
            '@default': 'identifier',
          }
        }],
        [/[(),]/, 'delimiter'],
      ],
    },
  });

  // Definir tema (solo una vez)
  monaco.editor.defineTheme('wsl-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '7dd3fc', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: '34d399' },
        { token: 'string', foreground: 'fbbf24' },
        { token: 'number', foreground: 'f472b6' },
        { token: 'comment', foreground: '475569', fontStyle: 'italic' },
        { token: 'operator', foreground: 'a78bfa' },
      ],
      colors: {
        'editor.background': '#0f172a',
        'editor.lineNumbersBackground': '#1e293b',
        'editor.selectionBackground': '#334155',
      },
    });

  try {
    monaco.editor.setTheme('wsl-dark');
  } catch (e) {
    console.warn('Theme "wsl-dark" not available, using vs-dark');
    monaco.editor.setTheme('vs-dark');
  }
}

// ─── Acciones disponibles por tipo de objeto SCADA ───────────────────────────

const SCADA_OBJECT_ACTIONS = {
  relay:   ['ON', 'OFF', 'TOGGLE'],
  motor:   ['ON', 'OFF', 'TOGGLE'],
  sensor:  ['VALUE'],
  lamp:    ['ON', 'OFF', 'TOGGLE'],
  button:  ['VALUE'],
  gauge:   ['VALUE'],
  valve:   ['OPEN', 'CLOSE', 'TOGGLE'],
  pump:    ['ON', 'OFF', 'TOGGLE'],
  alarm:   ['ACTIVE', 'RESET'],
  // fallback para tipos desconocidos
  default: ['ON', 'OFF', 'VALUE'],
};

const SCADA_ACTION_DOCS = {
  ON:     'Activar el dispositivo (1)',
  OFF:    'Desactivar el dispositivo (0)',
  TOGGLE: 'Invertir el estado actual',
  VALUE:  'Leer el valor actual del sensor',
  OPEN:   'Abrir la válvula',
  CLOSE:  'Cerrar la válvula',
  ACTIVE: 'Indica si la alarma está activa',
  RESET:  'Resetear la alarma',
};

// ─── Autocompletado avanzado ──────────────────────────────────────────────────

let _completionDisposable = null;

function registerWslCompletion(monaco, tags, scadaObjects) {
  // Desregistrar provider anterior si existe (para refrescar objetos SCADA)
  if (_completionDisposable) {
    _completionDisposable.dispose();
    _completionDisposable = null;
  }

  _completionDisposable = monaco.languages.registerCompletionItemProvider('wsl', {
    triggerCharacters: ['"', '(', '.'],

    provideCompletionItems: (model, position) => {
      const lineText = model.getLineContent(position.lineNumber);
      const textBefore = lineText.substring(0, position.column - 1);

      // ── Dot-completion: "Label." → acciones del objeto ──────────────────────
      const dotMatch = textBefore.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/);
      if (dotMatch) {
        const objLabel = dotMatch[1];
        const scadaObj = scadaObjects.find(o => o.label === objLabel);
        if (scadaObj) {
          const actions = SCADA_OBJECT_ACTIONS[scadaObj.type] || SCADA_OBJECT_ACTIONS.default;
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber:   position.lineNumber,
            startColumn:     position.column,
            endColumn:       position.column,
          };
          return {
            suggestions: actions.map(action => ({
              label: action,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              insertText: action,
              range,
              documentation: {
                value: [
                  `**${objLabel}.${action}**`,
                  '',
                  SCADA_ACTION_DOCS[action] || action,
                  '',
                  `*Tipo de objeto: ${scadaObj.type}*`,
                ].join('\n'),
              },
              sortText: `00_${action}`, // Mostrar primero
            })),
          };
        }
      }

      // ── Sugerencias generales ────────────────────────────────────────────────
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      };

      const suggestions = [
        // Keywords
        ...['ON', 'END', 'IF', 'THEN', 'ELSE', 'WHILE', 'DO', 'FOR', 'FROM', 'TO',
            'STARTUP', 'SHUTDOWN', 'INTERVAL', 'CHANGE', 'CLICK', 'AND', 'OR', 'NOT',
            'TRUE', 'FALSE', 'VAR'].map(kw => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          documentation: `Palabra clave WSL`,
        })),

        // Built-ins con paréntesis
        ...['SET', 'READ', 'LOG', 'NOTIFY', 'WAIT', 'ALARM'].map(fn => ({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${fn}($1)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: `Función WSL: ${fn}`,
        })),

        // NOW / MODE / DEVICE — paréntesis opcionales
        ...['NOW', 'MODE', 'DEVICE'].map(fn => ({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn,
          range,
          documentation: {
            value: `**${fn}** — paréntesis opcionales\n\nPuede usarse como \`${fn}\` o \`${fn}()\``,
          },
        })),

        // Tags de hardware
        ...tags.map(tag => ({
          label: tag,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `"${tag}"`,
          range,
          documentation: 'Tag de hardware',
          sortText: `98_${tag}`,
        })),

        // Objetos SCADA (etiquetas) — al escribir el nombre sugiere el objeto
        ...scadaObjects.map(obj => ({
          label: obj.label,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: obj.label,
          range,
          documentation: {
            value: [
              `**Objeto SCADA: ${obj.label}**`,
              '',
              `Tipo: \`${obj.type}\`  |  ID: \`${obj.id}\``,
              '',
              `Acciones disponibles:`,
              ...(SCADA_OBJECT_ACTIONS[obj.type] || SCADA_OBJECT_ACTIONS.default)
                .map(a => `- \`${obj.label}.${a}\` — ${SCADA_ACTION_DOCS[a] || a}`),
            ].join('\n'),
          },
          sortText: `97_${obj.label}`,
        })),

        // Snippets
        {
          label: 'ON INTERVAL',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'ON INTERVAL ${1:5s}\n\t${0}\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Bloque que se ejecuta cada intervalo de tiempo',
        },
        {
          label: 'ON CHANGE',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'ON CHANGE "${1:tag}"\n\t${0}\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Bloque que se ejecuta cuando un tag cambia de valor',
        },
        {
          label: 'ON STARTUP',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'ON STARTUP\n\t${0}\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Bloque que se ejecuta al iniciar el dispositivo',
        },
        {
          label: 'IF THEN',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'IF ${1:condicion} THEN\n\t${0}\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Condicional IF/THEN',
        },
        {
          label: 'SET motor ON',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'SET(${1:Motor}.ON)',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Encender un motor/relay por etiqueta',
        },
        {
          label: 'VAR',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'VAR ${1:nombre} = ${2:0}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          documentation: 'Declarar una variable: VAR nombre = valorInicial',
        },
      ];

      return { suggestions };
    },
  });
}

// ─── Code Actions (Quick Fixes) ──────────────────────────────────────────────
//
// Cada regla describe un patrón de mensaje de error y cómo transformar
// el texto de la línea afectada para corregirlo.
//
// fix puede ser:
//   { type:'replaceToken', find:RegExp, replace:string }   — reemplaza en la línea
//   { type:'replaceLine',  newText:string }                — reemplaza la línea completa
//   { type:'insertAfter',  text:string }                   — inserta línea después
//

const WSL_FIX_RULES = [
  // ── Funciones que necesitan paréntesis vacíos ────────────────────────────
  {
    match: /Se esperaba '\(' después de (NOW|MODE|DEVICE)/,
    title: (m) => `Agregar paréntesis: ${m[1]}()`,
    fix: (m) => ({ type: 'replaceToken', find: new RegExp(`\\b${m[1]}\\b(?!\\s*\\()`), replace: `${m[1]}()` }),
  },

  // ── Se esperaba ')' para cerrar llamada ──────────────────────────────────
  {
    match: /Se esperaba '\)' para cerrar (SET|LOG|NOTIFY|WAIT|READ|MODE|DEVICE|NOW|ALARM)/,
    title: (m) => `Agregar ')' de cierre en ${m[1]}(...)`,
    fix: (m, lineText) => {
      // Insertar ')' al final de la línea si no existe
      const trimmed = lineText.trimEnd();
      if (!trimmed.endsWith(')')) {
        return { type: 'replaceLine', newText: trimmed + ')' };
      }
      return null;
    },
  },

  // ── SET requiere tag entre comillas ──────────────────────────────────────
  {
    match: /SET requiere el nombre del tag entre comillas/,
    title: () => 'Envolver el tag en comillas: SET("tag", valor)',
    fix: () => ({ type: 'replaceLine', template: 'SET("$TAG", $VAL)' }),
  },

  // ── ON INTERVAL sin unidad ───────────────────────────────────────────────
  {
    match: /Unidad de tiempo inválida '(\w+)'/,
    title: (m) => `Cambiar unidad '${m[1]}' por 's' (segundos)`,
    fix: (m) => ({ type: 'replaceToken', find: new RegExp(`\\b${m[1]}\\b`), replace: 's' }),
  },
  {
    match: /ON INTERVAL requiere una unidad de tiempo/,
    title: () => "Agregar unidad de tiempo 's' al intervalo",
    fix: () => ({ type: 'replaceToken', find: /ON INTERVAL\s+(\d+)(?!\s*[smhSMH])/, replace: 'ON INTERVAL $1s' }),
  },

  // ── Nivel de alarma inválido ─────────────────────────────────────────────
  {
    match: /Nivel de alarma inválido '(\w*)'/,
    title: () => "Usar nivel 'WARN'",
    fix: (m) => ({ type: 'replaceToken', find: new RegExp(`\\b${m[1]}\\b`), replace: 'WARN' }),
  },

  // ── Se esperaba THEN ─────────────────────────────────────────────────────
  {
    match: /Se esperaba 'THEN' después de la condición del IF/,
    title: () => "Agregar 'THEN' después de la condición",
    fix: (_m, lineText) => {
      // Intentar agregar THEN al final de la línea IF si no lo tiene
      if (/\bIF\b/.test(lineText) && !/\bTHEN\b/.test(lineText)) {
        return { type: 'replaceLine', newText: lineText.trimEnd() + ' THEN' };
      }
      return null;
    },
  },

  // ── Se esperaba END ──────────────────────────────────────────────────────
  {
    match: /Se esperaba 'END' para cerrar el bloque ON|Se esperaba 'END' para cerrar el (IF|WHILE|FOR)/,
    title: () => "Insertar 'END' después de esta línea",
    fix: () => ({ type: 'insertAfter', text: 'END' }),
  },

  // ── Se esperaba DO en WHILE ──────────────────────────────────────────────
  {
    match: /Se esperaba 'DO' después de la condición del WHILE/,
    title: () => "Agregar 'DO' después de la condición",
    fix: (_m, lineText) => {
      if (/\bWHILE\b/.test(lineText) && !/\bDO\b/.test(lineText)) {
        return { type: 'replaceLine', newText: lineText.trimEnd() + ' DO' };
      }
      return null;
    },
  },

  // ── Se esperaba FROM / TO en FOR ─────────────────────────────────────────
  {
    match: /Se esperaba 'FROM' en el FOR/,
    title: () => "Completar: FOR x FROM 1 TO 10",
    fix: (_m, lineText) => {
      const varMatch = lineText.match(/\bFOR\s+(\w+)/);
      const v = varMatch?.[1] ?? 'i';
      return { type: 'replaceLine', newText: `FOR ${v} FROM 1 TO 10` };
    },
  },

  // ── Carácter inesperado '!' ──────────────────────────────────────────────
  {
    match: /Carácter inesperado '!', ¿quiso decir '!='/,
    title: () => "Cambiar '!' por '!='",
    fix: () => ({ type: 'replaceToken', find: /!(?!=)/, replace: '!=' }),
  },

  // ── Asignación sin '=' ───────────────────────────────────────────────────
  {
    match: /Sentencia inválida '(\w+)' — ¿falta el '=' para asignar/,
    title: (m) => `Convertir en asignación: ${m[1]} = ...`,
    fix: (m, lineText) => {
      // Insertar ' = 0' si no tiene '='
      if (!lineText.includes('=')) {
        return { type: 'replaceLine', newText: lineText.trimEnd() + ' = 0' };
      }
      return null;
    },
  },
];

// ─── Bandera para evitar registro múltiple de code actions ───────────────────
let _codeActionDisposable = null;

function registerWslCodeActions(monaco) {
  if (_codeActionDisposable) {
    _codeActionDisposable.dispose();
    _codeActionDisposable = null;
  }

  _codeActionDisposable = monaco.languages.registerCodeActionProvider('wsl', {
    provideCodeActions(model, _range, context) {
      const actions = [];

      for (const marker of context.markers) {
        const msg     = marker.message ?? '';
        const lineNum = marker.startLineNumber;
        const lineText = model.getLineContent(lineNum);

        for (const rule of WSL_FIX_RULES) {
          const m = msg.match(rule.match);
          if (!m) continue;

          const fixDef = rule.fix(m, lineText);
          if (!fixDef) continue;

          const title = rule.title(m);
          let edits = null;

          if (fixDef.type === 'replaceToken') {
            // Buscar la primera ocurrencia del patrón en la línea y reemplazar
            const newLine = lineText.replace(fixDef.find, fixDef.replace);
            if (newLine === lineText) continue; // nada cambió
            edits = [{
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: lineNum, startColumn: 1,
                  endLineNumber: lineNum,   endColumn: lineText.length + 1,
                },
                text: newLine,
              },
              versionId: model.getVersionId(),
            }];
          } else if (fixDef.type === 'replaceLine') {
            edits = [{
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: lineNum, startColumn: 1,
                  endLineNumber: lineNum,   endColumn: lineText.length + 1,
                },
                text: fixDef.newText,
              },
              versionId: model.getVersionId(),
            }];
          } else if (fixDef.type === 'insertAfter') {
            const indent = lineText.match(/^(\s*)/)[1];
            edits = [{
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: lineNum + 1, startColumn: 1,
                  endLineNumber: lineNum + 1,   endColumn: 1,
                },
                text: indent + fixDef.text + '\n',
              },
              versionId: model.getVersionId(),
            }];
          }

          if (edits) {
            actions.push({
              title,
              kind: 'quickfix',
              diagnostics: [marker],
              isPreferred: true,
              edit: { edits },
            });
          }

          break; // primera regla que coincide es suficiente por marker
        }

        // ── Fix genérico: siempre disponible si ninguna regla específica aplica ──
        const hasSpecificFix = actions.some(a => a.diagnostics?.[0] === marker);
        if (!hasSpecificFix) {
          actions.push(_genericFix(monaco, model, marker, lineText));
        }
      }

      return { actions, dispose() {} };
    },
  });
}

/**
 * Fix genérico: muestra el error completo como comentario explicativo
 * y ofrece envolver la línea problemática en un comentario para continuar.
 */
function _genericFix(monaco, model, marker, lineText) {
  const lineNum = marker.startLineNumber;
  const indent  = lineText.match(/^(\s*)/)[1];

  return {
    title: `Comentar línea con error (${lineNum})`,
    kind: 'quickfix',
    diagnostics: [marker],
    isPreferred: false,
    edit: {
      edits: [{
        resource: model.uri,
        textEdit: {
          range: {
            startLineNumber: lineNum, startColumn: 1,
            endLineNumber:   lineNum, endColumn: lineText.length + 1,
          },
          text: `${indent}// [ERROR] ${lineText.trimStart()}`,
        },
        versionId: model.getVersionId(),
      }],
    },
  };
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    width: '100%',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
    padding: '0 16px',
    height: 44,
    gap: 16,
    flexShrink: 0,
  },
  toolbarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  },
  btnPrimary: {
    background: '#22c55e',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  btnSecondary: {
    background: '#374151',
    border: '1px solid #4b5563',
    borderRadius: 6,
    color: '#e2e8f0',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  btnDanger: {
    background: '#ef4444',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: 0,
    minHeight: 0,
  },
  editorContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 0,
    minWidth: 0,
  },
  debugPanel: {
    width: 320,
    background: '#1e293b',
    borderLeft: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minHeight: 0,
  },
  debugSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid #334155',
    minHeight: 0,
  },
  debugTitle: {
    padding: '8px 12px',
    background: '#0f172a',
    borderBottom: '1px solid #334155',
    fontSize: 12,
    fontWeight: 600,
    color: '#38bdf8',
    flexShrink: 0,
  },
  debugContent: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 12px',
    fontSize: 11,
    minHeight: 0,
  },
};
