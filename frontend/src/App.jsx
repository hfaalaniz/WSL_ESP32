import React, { useMemo, useState, useRef, useCallback } from 'react';
import { generateTagsWithMetadata } from './utils/tagGenerator.js';
import { useScadaStore } from './store/scadaStore.js';
import { ScadaEditor, HardwareConfigurator, FirmwareGenerator, WslScriptEditor, DeviceManager } from './components/index.js';

// ─── Utilidades de archivo .scada ─────────────────────────────────────────────

function buildScadaFileContent(project) {
  const now = new Date().toISOString();
  return [
    '##SCADA_FILE_V1',
    `##CREATED: ${now}`,
    `##PROJECT: ${project.name || 'Sin nombre'}`,
    `##ID: ${project.id || ''}`,
    `##DESCRIPTION: ${project.description || ''}`,
    '',
    '[HARDWARE]',
    JSON.stringify(project.hardware ?? null, null, 2),
    '',
    '[DESIGN]',
    JSON.stringify({ screens: project.screens ?? [] }, null, 2),
    '',
    '[SCRIPT]',
    project.script ?? '',
  ].join('\n');
}

function parseScadaFileContent(text) {
  const hwMatch     = text.match(/\[HARDWARE\]([\s\S]*?)(?=\[DESIGN\]|\[SCRIPT\]|$)/);
  const designMatch = text.match(/\[DESIGN\]([\s\S]*?)(?=\[SCRIPT\]|$)/);
  const scriptMatch = text.match(/\[SCRIPT\]([\s\S]*?)$/);
  const nameMatch   = text.match(/##PROJECT:\s*(.+)/);
  const idMatch     = text.match(/##ID:\s*(.+)/);
  const descMatch   = text.match(/##DESCRIPTION:\s*(.+)/);

  let hardware = null, screens = [], script = '';
  try { hardware = JSON.parse(hwMatch?.[1]?.trim() || 'null'); } catch {}
  try {
    const d = JSON.parse(designMatch?.[1]?.trim() || '{}');
    if (d.screens?.length) screens = d.screens;
  } catch {}
  if (scriptMatch) script = scriptMatch[1].trim();

  return {
    name:        nameMatch?.[1]?.trim() || 'Proyecto importado',
    id:          idMatch?.[1]?.trim()   || null,
    description: descMatch?.[1]?.trim() || '',
    hardware,
    screens,
    script,
    firmware:    null,
    created:     new Date().toISOString(),
    modified:    new Date().toISOString(),
  };
}

// ─── Barra única de cabecera ──────────────────────────────────────────────────

function TopBar() {
  const {
    currentPhase, setPhase, getPhaseStatus,
    currentProject, setProject, saveProject, newProject,
    setHardware, setScreens, setScript, setFirmware,
  } = useScadaStore();

  const phaseStatus = getPhaseStatus();
  const fileInputRef = useRef(null);
  const [saving, setSaving]   = useState(false);   // feedback visual guardar
  const [opening, setOpening] = useState(false);   // feedback visual abrir
  const [saveMsg, setSaveMsg] = useState('');

  const phases = [
    { id: 'F1', label: 'Schema',     icon: '📋' },
    { id: 'F2', label: 'Hardware',   icon: '⚙'  },
    { id: 'F3', label: 'Firmware',   icon: '⚡' },
    { id: 'F4', label: 'Editor',     icon: '🎨' },
    { id: 'F5', label: 'Parser',     icon: '🔧' },
    { id: 'F6', label: 'Dispositivo',icon: '📡' },
  ];

  const completedCount   = phases.filter(p => phaseStatus[p.id]).length;
  const progressPercent  = (completedCount / phases.length) * 100;

  // ── Guardar en disco ────────────────────────────────────────────────────────
  const handleSaveToDisk = useCallback(async () => {
    setSaving(true);
    setSaveMsg('');

    // Primero persistir en el store
    saveProject();

    const content  = buildScadaFileContent(currentProject);
    const filename = `${(currentProject.name || 'proyecto').replace(/\s+/g, '_')}.scada`;

    try {
      // File System Access API (Chrome/Edge)
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Archivo SCADA', accept: { 'text/plain': ['.scada'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setSaveMsg('Guardado');
      } else {
        // Fallback: descarga automática
        const blob = new Blob([content], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setSaveMsg('Descargado');
      }
    } catch (e) {
      if (e.name !== 'AbortError') setSaveMsg('Error al guardar');
    }

    setSaving(false);
    setTimeout(() => setSaveMsg(''), 3000);
  }, [currentProject, saveProject]);

  // ── Abrir desde disco ───────────────────────────────────────────────────────
  const handleOpenFromDisk = useCallback(async () => {
    try {
      // File System Access API
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Archivo SCADA', accept: { 'text/plain': ['.scada'] } }],
          multiple: false,
        });
        setOpening(true);
        const file = await handle.getFile();
        const text = await file.text();
        const proj = parseScadaFileContent(text);
        setProject({ name: proj.name, id: proj.id, description: proj.description,
                     created: proj.created, modified: proj.modified });
        setHardware(proj.hardware);
        setScreens(proj.screens);
        setScript(proj.script);
        if (proj.firmware) setFirmware(proj.firmware);
        saveProject();
        setOpening(false);
      } else {
        // Fallback: input file
        fileInputRef.current?.click();
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Error al abrir:', e);
      setOpening(false);
    }
  }, [setProject, setHardware, setScreens, setScript, setFirmware, saveProject]);

  // Fallback para navegadores sin File System Access API
  const handleFileInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOpening(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const proj = parseScadaFileContent(ev.target.result);
      setProject({ name: proj.name, id: proj.id, description: proj.description,
                   created: proj.created, modified: proj.modified });
      setHardware(proj.hardware);
      setScreens(proj.screens);
      setScript(proj.script);
      if (proj.firmware) setFirmware(proj.firmware);
      saveProject();
      setOpening(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [setProject, setHardware, setScreens, setScript, setFirmware, saveProject]);

  return (
    <div style={tb.root}>
      {/* Logo */}
      <div style={tb.logo}>
        <span style={tb.logoIcon}>⚡</span>
        <div>
          <div style={tb.logoTitle}>WSL SCADA</div>
          <div style={tb.logoSub}>Sistema de Control</div>
        </div>
      </div>

      <div style={tb.sep} />

      {/* Nombre del proyecto (editable inline) */}
      <input
        value={currentProject.name}
        onChange={(e) => setProject({ name: e.target.value })}
        style={tb.projectName}
        title="Nombre del proyecto"
        spellCheck={false}
      />

      <div style={tb.sep} />

      {/* Fases de navegación */}
      <div style={tb.phases}>
        {phases.map((phase, index) => {
          const isActive    = currentPhase === phase.id;
          const isCompleted = phaseStatus[phase.id];
          return (
            <React.Fragment key={phase.id}>
              <button
                onClick={() => setPhase(phase.id)}
                title={phase.id}
                style={{
                  ...tb.phaseBtn,
                  ...(isActive    ? tb.phaseBtnActive    : {}),
                  ...(isCompleted && !isActive ? tb.phaseBtnDone : {}),
                }}
              >
                <span style={{ fontSize: 13 }}>{phase.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{phase.label}</span>
                {isCompleted && !isActive && (
                  <span style={tb.phaseDot}>✓</span>
                )}
              </button>
              {index < phases.length - 1 && (
                <span style={tb.arrow}>›</span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Barra de progreso compacta */}
      <div style={tb.progressWrap} title={`${completedCount}/${phases.length} fases completadas`}>
        <div style={{ ...tb.progressBar, width: `${progressPercent}%` }} />
      </div>
      <span style={tb.progressLabel}>{completedCount}/{phases.length}</span>

      <div style={tb.sep} />

      {/* Modificado */}
      <span style={tb.modified} title="Última modificación">
        {new Date(currentProject.modified).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
      </span>

      <div style={tb.sep} />

      {/* Acciones de archivo */}
      <div style={tb.actions}>
        {/* Abrir */}
        <button onClick={handleOpenFromDisk} style={tb.btnFile} title="Abrir proyecto desde disco (.scada)">
          {opening ? '⏳' : '📂'} Abrir
        </button>

        {/* Guardar en disco */}
        <button
          onClick={handleSaveToDisk}
          style={{ ...tb.btnFile, ...tb.btnSave }}
          title="Guardar proyecto en disco (.scada)"
          disabled={saving}
        >
          {saving ? '⏳' : '💾'} Guardar
          {saveMsg && <span style={tb.saveMsg}>{saveMsg}</span>}
        </button>

        {/* Nuevo proyecto */}
        <button
          onClick={() => { if (confirm('¿Crear nuevo proyecto? Los cambios no guardados se perderán.')) newProject(); }}
          style={tb.btnNew}
          title="Nuevo proyecto"
        >
          ＋ Nuevo
        </button>
      </div>

      {/* Input file oculto para fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".scada,.txt"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}

// ─── Estilos de la barra ──────────────────────────────────────────────────────

const tb = {
  root: {
    display: 'flex',
    alignItems: 'center',
    height: 44,
    flexShrink: 0,
    background: '#0f172a',
    borderBottom: '1px solid #1e293b',
    padding: '0 12px',
    gap: 8,
    overflow: 'hidden',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
  },
  logoIcon: {
    width: 26, height: 26, borderRadius: 6,
    background: '#38bdf822', border: '1px solid #38bdf8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, flexShrink: 0,
  },
  logoTitle: { fontSize: 13, fontWeight: 700, color: '#38bdf8', lineHeight: 1.1 },
  logoSub:   { fontSize: 9,  color: '#475569', lineHeight: 1.1 },
  sep: {
    width: 1, height: 20, background: '#1e293b', flexShrink: 0,
  },
  projectName: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 4,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 6px',
    outline: 'none',
    minWidth: 120,
    maxWidth: 200,
    flexShrink: 1,
    cursor: 'text',
    ':hover': { borderColor: '#334155' },
  },
  phases: {
    display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
  },
  phaseBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px',
    borderRadius: 5,
    border: '1px solid transparent',
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    transition: 'all 0.15s',
    position: 'relative',
    whiteSpace: 'nowrap',
  },
  phaseBtnActive: {
    background: '#38bdf822',
    border: '1px solid #38bdf8',
    color: '#38bdf8',
  },
  phaseBtnDone: {
    color: '#22c55e',
  },
  phaseDot: {
    fontSize: 9, color: '#22c55e', marginLeft: 1,
  },
  arrow: {
    color: '#334155', fontSize: 14, userSelect: 'none', flexShrink: 0,
  },
  progressWrap: {
    width: 60, height: 4, background: '#1e293b', borderRadius: 2,
    overflow: 'hidden', flexShrink: 0,
  },
  progressBar: {
    height: '100%', background: '#38bdf8', borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: 10, color: '#475569', flexShrink: 0, minWidth: 24,
  },
  modified: {
    fontSize: 10, color: '#475569', flexShrink: 0, whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0,
  },
  btnFile: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 5,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnSave: {
    background: '#14532d',
    border: '1px solid #22c55e',
    color: '#22c55e',
  },
  btnNew: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: 5,
    color: '#64748b',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  saveMsg: {
    fontSize: 10, color: '#4ade80', marginLeft: 4,
  },
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function App() {
  const { currentPhase, currentProject, setProject, setScript, nextPhase } = useScadaStore();

  const hwTags = useMemo(
    () => generateTagsWithMetadata(currentProject.hardware).map(t => t.tag),
    [currentProject.hardware]
  );

  const scadaObjects = useMemo(() => {
    const objs = [];
    for (const screen of currentProject.screens || []) {
      for (const obj of screen.objects || []) {
        if (obj.label) objs.push({ label: obj.label, type: obj.type, id: obj.id });
      }
    }
    return objs;
  }, [currentProject.screens]);

  const renderCurrentPhase = () => {
    switch (currentPhase) {
      case 'F1':
        return <SchemaPhase />;
      case 'F2':
        return <HardwareConfigurator />;
      case 'F3':
        return <FirmwareGenerator />;
      case 'F4':
        return <ScadaEditor />;
      case 'F5':
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <WslScriptEditor
              script={currentProject.script || ''}
              onChange={(script) => setScript(script)}
              tags={hwTags}
              scadaObjects={scadaObjects}
              hardware={currentProject.hardware}
              onExecute={(logs) => console.log('Ejecución:', logs)}
            />
          </div>
        );
      case 'F6':
        return <DeviceManager />;
      default:
        return null;
    }
  };

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#e2e8f0' }}>
      <TopBar />
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {renderCurrentPhase()}
      </div>
    </div>
  );
}

// ─── Fase F1: Schema ──────────────────────────────────────────────────────────

function SchemaPhase() {
  const { currentProject, setProject, nextPhase, getPhaseStatus } = useScadaStore();
  const phaseStatus = getPhaseStatus();

  const phases = [
    { id: 'F1', label: 'Schema .scada',   desc: 'Estructura del proyecto',   icon: '📋', status: true },
    { id: 'F2', label: 'Config Hardware', desc: 'Definir dispositivos',       icon: '⚙',  status: !!currentProject.hardware },
    { id: 'F3', label: 'Firmware ESP32',  desc: 'Generar código Arduino',     icon: '⚡', status: !!currentProject.firmware },
    { id: 'F4', label: 'Editor Canvas',   desc: 'Diseño visual SCADA',        icon: '🎨', status: currentProject.screens?.length > 0 },
    { id: 'F5', label: 'Parser WSL',      desc: 'Scripts de automatización',  icon: '🔧', status: !!currentProject.script?.trim() },
    { id: 'F6', label: 'Dispositivo',     desc: 'Placa, firmware y script',   icon: '📡', status: !!currentProject.hardware },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header de fase */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Fase 1 — Schema .scada</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Define la estructura y metadatos del proyecto</div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Panel izquierdo */}
        <div style={{ width: 380, background: '#0f172a', borderRight: '1px solid #1e293b', padding: 24, overflowY: 'auto' }}>
          <h3 style={{ color: '#38bdf8', marginTop: 0, marginBottom: 20, fontSize: 14 }}>Información del Proyecto</h3>

          {[
            { label: 'NOMBRE', key: 'name', placeholder: 'Ej: Sistema de Control Planta', mono: false },
            { label: 'ID ÚNICO', key: 'id',   placeholder: 'equipo-01', mono: true },
          ].map(({ label, key, placeholder, mono }) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 5, letterSpacing: 0.5 }}>{label}</label>
              <input
                type="text"
                value={currentProject[key] || ''}
                onChange={(e) => setProject({ [key]: e.target.value })}
                placeholder={placeholder}
                style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: mono ? 'monospace' : 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          ))}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 5, letterSpacing: 0.5 }}>DESCRIPCIÓN</label>
            <textarea
              value={currentProject.description}
              onChange={(e) => setProject({ description: e.target.value })}
              placeholder="Describe brevemente el propósito del proyecto..."
              rows={3}
              style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          <button
            onClick={() => nextPhase()}
            style={{ width: '100%', padding: '10px', background: '#22c55e', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 8 }}
          >
            Continuar a Hardware →
          </button>
        </div>

        {/* Panel derecho: estado de fases */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <h3 style={{ color: '#38bdf8', marginTop: 0, marginBottom: 16, fontSize: 14 }}>Flujo de Desarrollo</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {phases.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#1e293b', borderRadius: 8, border: `1px solid ${p.status ? '#22c55e44' : '#334155'}` }}>
                <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{p.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: p.status ? '#e2e8f0' : '#64748b' }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.desc}</div>
                </div>
                <span style={{ fontSize: 13, color: p.status ? '#22c55e' : '#334155' }}>{p.status ? '✓' : '○'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
