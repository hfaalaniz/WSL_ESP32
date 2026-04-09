/**
 * ScadaEditor.jsx — F5
 * Editor visual canvas (Konva) + Script WSL (Monaco).
 *
 * Dependencias npm:
 *   react-konva konva @monaco-editor/react
 *
 * Props:
 *   hardware  {object}  — salida del HardwareConfigurator (F2), opcional
 *   onSave    {fn}      — callback(scadaText) al exportar .scada
 */

import React, {
  useState, useRef, useCallback, useEffect, useMemo
} from 'react';
import { Stage, Layer, Group, Rect, Circle, Text, Line, RegularPolygon } from 'react-konva';
import MonacoEditor from '@monaco-editor/react';
import { generateTags } from '../../utils/tagGenerator.js';
import { useScadaStore } from '../../store/scadaStore.js';
import { WslRuntime } from '../../engine/WslRuntime.js';

// ─── Tipos de objetos del canvas ─────────────────────────────────────────────

const OBJECT_CATEGORIES = [
  {
    label: 'Sensores',
    color: '#4d9fff',
    items: [
      { type: 'sensor_temp',     icon: '🌡', label: 'Temperatura', unit: '°C' },
      { type: 'sensor_pressure', icon: '⊙',  label: 'Presión',     unit: 'bar' },
      { type: 'sensor_current',  icon: '⚡', label: 'Corriente',   unit: 'A' },
      { type: 'sensor_digital',  icon: '◉',  label: 'Digital',     unit: '' },
    ],
  },
  {
    label: 'Actuadores',
    color: '#00d4aa',
    items: [
      { type: 'motor',   icon: '⚙',  label: 'Motor'   },
      { type: 'valve',   icon: '⧖',  label: 'Válvula' },
      { type: 'relay',   icon: '⊟',  label: 'Relé'    },
    ],
  },
  {
    label: 'Indicadores',
    color: '#f59e0b',
    items: [
      { type: 'indicator',       icon: '●',   label: 'Piloto'   },
      { type: 'alarm_light',     icon: '⚠',   label: 'Alarma'   },
      { type: 'level_bar',       icon: '▮',   label: 'Nivel'    },
      { type: 'numeric_display', icon: '0.0', label: 'Número'   },
    ],
  },
  {
    label: 'Controles',
    color: '#a78bfa',
    items: [
      { type: 'switch', icon: '⊡', label: 'Switch' },
      { type: 'button', icon: '▣', label: 'Botón'  },
    ],
  },
  {
    label: 'Planta',
    color: '#94a3b8',
    items: [
      { type: 'tank',  icon: '▬', label: 'Tanque'   },
      { type: 'pipe',  icon: '━', label: 'Tubería'  },
      { type: 'label', icon: 'T', label: 'Etiqueta' },
    ],
  },
];

// Color base por categoría
const TYPE_META = {};
OBJECT_CATEGORIES.forEach(cat =>
  cat.items.forEach(item => {
    TYPE_META[item.type] = { icon: item.icon, label: item.label, color: cat.color, unit: item.unit || '' };
  })
);

// Prefijos de 3 letras por tipo de objeto
const TYPE_PREFIX = {
  sensor_temp:     'tmp',
  sensor_pressure: 'pre',
  sensor_current:  'cur',
  sensor_digital:  'dig',
  motor:           'mot',
  valve:           'vlv',
  relay:           'rel',
  pilot_light:     'plt',
  alarm_indicator: 'alm',
  level_bar:       'lvl',
  numeric_display: 'num',
  switch:          'swt',
  button:          'btn',
  tank:            'tnk',
  pipe:            'pip',
  label:           'lbl',
};

function makeObjectId(type, existingObjects) {
  const prefix = TYPE_PREFIX[type] || type.slice(0, 3);
  // Contar cuántos objetos de este prefijo ya existen para asignar el siguiente número
  const count = existingObjects.filter(o => o.id.startsWith(prefix + '-')).length + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

// Template de nuevo objeto
function makeObject(type, x, y, existingObjects = []) {
  const id = makeObjectId(type, existingObjects);
  return {
    id,
    type,
    x,
    y,
    w: type === 'pipe' ? 120 : type === 'label' ? 100 : 72,
    h: type === 'pipe' ? 20  : type === 'level_bar' ? 100 : 72,
    label: TYPE_META[type]?.label || type,
    tag:   '',
    unit:  TYPE_META[type]?.unit  || '',
    rotation: 0,
    style: {
      colorOn:    '#00d4aa',
      colorOff:   '#4b5563',
      colorAlarm: '#ef4444',
    },
    alarm: { enabled: false, min: null, max: null, severity: 'WARN' },
    interaction: { clickable: false, command: 'TOGGLE', value: 1 },
  };
}

// ─── Renderizador de formas (Konva) ──────────────────────────────────────────

function ObjectShape({ type, w, h, color, value, selected }) {
  const cx = w / 2, cy = h / 2;
  const r  = Math.min(w, h) * 0.38;

  const shapeProps = { fill: color, opacity: 0.9, listening: false };
  const iconStyle  = { fontSize: Math.min(w, h) * 0.4, fill: '#fff', align: 'center', listening: false };

  switch (type) {
    // ── Sensores ──
    case 'sensor_temp':
      return (
        <>
          <Rect x={cx - 6} y={4} width={12} height={h - 20} cornerRadius={6} {...shapeProps} />
          <Circle x={cx} y={h - 12} radius={10} {...shapeProps} />
          <Text x={0} y={cy - 6} width={w} text={TYPE_META[type].icon} {...iconStyle} />
        </>
      );
    case 'sensor_pressure':
      return (
        <>
          <Circle x={cx} y={cy} radius={r} {...shapeProps} />
          <Circle x={cx} y={cy} radius={r * 0.6} fill='#1e293b' opacity={0.8} listening={false} />
          <Line points={[cx, cy, cx + r * 0.5, cy - r * 0.5]} stroke='#fff' strokeWidth={2} listening={false} />
          <Text x={0} y={h - 18} width={w} text='P' fontSize={11} fill='#fff' align='center' listening={false} />
        </>
      );
    case 'sensor_current':
      return (
        <>
          <Circle x={cx} y={cy} radius={r} {...shapeProps} />
          <Text x={0} y={cy - 14} width={w} text='A' fontSize={Math.min(w,h)*0.35} fill='#fff' align='center' fontStyle='bold' listening={false} />
        </>
      );
    case 'sensor_digital':
      return (
        <>
          <Rect x={cx - r} y={cy - r} width={r*2} height={r*2} cornerRadius={4} {...shapeProps} />
          <Circle x={cx} y={cy} radius={r * 0.4} fill='#1e293b' opacity={0.8} listening={false} />
        </>
      );

    // ── Actuadores ──
    case 'motor':
      return (
        <>
          <Circle x={cx} y={cy} radius={r} {...shapeProps} />
          <Circle x={cx} y={cy} radius={r * 0.55} fill='#1e293b' opacity={0.8} listening={false} />
          {[0, 60, 120, 180, 240, 300].map(deg => {
            const rad = (deg * Math.PI) / 180;
            return (
              <Line key={deg}
                points={[cx + r*0.55*Math.cos(rad), cy + r*0.55*Math.sin(rad),
                         cx + r*0.9 *Math.cos(rad), cy + r*0.9 *Math.sin(rad)]}
                stroke={color} strokeWidth={3} listening={false} />
            );
          })}
          <Text x={0} y={cy-8} width={w} text='M' fontSize={14} fill='#fff' align='center' fontStyle='bold' listening={false} />
        </>
      );
    case 'valve':
      return (
        <>
          <RegularPolygon x={cx} y={cy} sides={3} radius={r} rotation={0}  {...shapeProps} />
          <RegularPolygon x={cx} y={cy} sides={3} radius={r} rotation={180} fill={color} opacity={0.7} listening={false} />
          <Rect x={cx-3} y={4} width={6} height={12} fill={color} opacity={0.9} listening={false} />
        </>
      );
    case 'relay':
      return (
        <>
          <Rect x={cx-r} y={cy-r*0.7} width={r*2} height={r*1.4} cornerRadius={3} {...shapeProps} />
          <Line points={[cx-r*0.4, cy, cx+r*0.1, cy-r*0.4, cx+r*0.4, cy]}
            stroke='#fff' strokeWidth={2} listening={false} />
          <Circle x={cx+r*0.4} y={cy} radius={3} fill='#fff' listening={false} />
        </>
      );

    // ── Indicadores ──
    case 'indicator':
      return (
        <>
          <Circle x={cx} y={cy} radius={r} {...shapeProps} />
          <Circle x={cx} y={cy} radius={r*0.6} fill='#fff' opacity={0.15} listening={false} />
        </>
      );
    case 'alarm_light':
      return (
        <>
          <Circle x={cx} y={cy} radius={r} fill='#ef4444' opacity={0.85} listening={false} />
          <Text x={0} y={cy-14} width={w} text='!' fontSize={22} fill='#fff' align='center' fontStyle='bold' listening={false} />
        </>
      );
    case 'level_bar':
      return (
        <>
          <Rect x={cx-14} y={4} width={28} height={h-8} cornerRadius={3} stroke={color} strokeWidth={2} fill='#1e293b' listening={false} />
          <Rect x={cx-12} y={h/2} width={24} height={h/2-6} fill={color} opacity={0.85} listening={false} />
          <Text x={0} y={2} width={w} text='50%' fontSize={10} fill='#94a3b8' align='center' listening={false} />
        </>
      );
    case 'numeric_display':
      return (
        <>
          <Rect x={4} y={cy-16} width={w-8} height={32} cornerRadius={4} fill='#0f172a' stroke={color} strokeWidth={1.5} listening={false} />
          <Text x={4} y={cy-10} width={w-8} text='0.00' fontSize={18} fill={color} align='center' fontStyle='bold' listening={false} />
        </>
      );

    // ── Controles ──
    case 'switch':
      return (
        <>
          <Rect x={cx-22} y={cy-12} width={44} height={24} cornerRadius={12} fill='#374151' listening={false} />
          <Circle x={cx-10} y={cy} radius={10} fill='#6b7280' listening={false} />
        </>
      );
    case 'button':
      return (
        <>
          <Rect x={cx-r} y={cy-r*0.6} width={r*2} height={r*1.2} cornerRadius={6} {...shapeProps} />
          <Text x={0} y={cy-8} width={w} text='BTN' fontSize={12} fill='#fff' align='center' listening={false} />
        </>
      );

    // ── Planta ──
    case 'tank':
      return (
        <>
          <Rect x={8} y={8} width={w-16} height={h-16} cornerRadius={6} stroke={color} strokeWidth={2} fill='#1e293b' listening={false} />
          <Rect x={10} y={h*0.5} width={w-20} height={h*0.44} fill={color} opacity={0.3} listening={false} />
        </>
      );
    case 'pipe':
      return (
        <Rect x={0} y={h/2-6} width={w} height={12} cornerRadius={6} {...shapeProps} />
      );
    case 'label':
      return (
        <Text x={2} y={cy-10} width={w-4} text='Label' fontSize={14} fill='#e2e8f0' align='center' listening={false} />
      );

    default:
      return <Rect x={cx-r} y={cy-r} width={r*2} height={r*2} {...shapeProps} />;
  }
}

// ─── Objeto del canvas (Konva Group draggable) ────────────────────────────────

// Determina si un valor de tag representa "activo/encendido"
function isTagActive(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value !== 0;
  if (typeof value === 'string')  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'on';
  return false;
}

function CanvasObject({ obj, selected, onSelect, onDragEnd, tagValue, isRuntime, onRuntimeClick }) {
  const baseMeta  = TYPE_META[obj.type];
  const active    = isRuntime ? isTagActive(tagValue) : false;

  // Color según estado en runtime
  const color = isRuntime
    ? (active ? (obj.style?.colorOn || '#00d4aa') : (obj.style?.colorOff || '#4b5563'))
    : (baseMeta?.color || '#4d9fff');

  // En modo alarma (valor fuera de rango)
  const inAlarm = isRuntime && obj.alarm?.enabled && typeof tagValue === 'number' && (
    (obj.alarm.min !== null && tagValue < obj.alarm.min) ||
    (obj.alarm.max !== null && tagValue > obj.alarm.max)
  );
  const effectiveColor = inAlarm ? (obj.style?.colorAlarm || '#ef4444') : color;

  const handleClick = isRuntime && onRuntimeClick
    ? () => onRuntimeClick(obj.id)
    : (onSelect ? () => onSelect(obj.id) : undefined);

  return (
    <Group
      id={obj.id}
      x={obj.x}
      y={obj.y}
      width={obj.w}
      height={obj.h}
      draggable={!!onDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={onDragEnd ? e => onDragEnd(obj.id, { x: e.target.x(), y: e.target.y() }) : undefined}
    >
      {/* Fondo */}
      <Rect
        width={obj.w}
        height={obj.h}
        cornerRadius={6}
        fill={isRuntime ? (active ? '#0a2a1a' : '#1e293b') : '#1e293b'}
        stroke={inAlarm ? '#ef4444' : selected ? '#3b82f6' : (isRuntime && active ? effectiveColor : '#374151')}
        strokeWidth={inAlarm ? 2 : selected ? 2 : (isRuntime && active ? 1.5 : 1)}
        shadowColor={inAlarm ? '#ef4444' : selected ? '#3b82f6' : (isRuntime && active ? effectiveColor : 'transparent')}
        shadowBlur={inAlarm ? 12 : selected ? 8 : (isRuntime && active ? 6 : 0)}
        listening={true}
      />

      {/* Forma */}
      <ObjectShape type={obj.type} w={obj.w} h={obj.h} color={effectiveColor} value={tagValue} />

      {/* Etiqueta */}
      <Text
        x={0}
        y={obj.h - 16}
        width={obj.w}
        text={obj.label}
        fontSize={10}
        fill={isRuntime && active ? '#e2e8f0' : '#94a3b8'}
        align='center'
        listening={false}
      />

      {/* Valor en runtime */}
      {isRuntime && tagValue !== undefined && tagValue !== null && (
        <Text
          x={0}
          y={4}
          width={obj.w}
          text={typeof tagValue === 'number' ? tagValue.toFixed(2) : String(tagValue)}
          fontSize={9}
          fill={effectiveColor}
          align='center'
          listening={false}
        />
      )}

      {/* Tag badge en diseño */}
      {!isRuntime && obj.tag && (
        <Rect x={1} y={1} width={8} height={8} cornerRadius={2} fill='#22c55e' listening={false} />
      )}

      {/* Handles de selección */}
      {selected && !isRuntime && [
        [0, 0], [obj.w, 0], [0, obj.h], [obj.w, obj.h]
      ].map(([hx, hy], i) => (
        <Circle key={i} x={hx} y={hy} radius={4} fill='#3b82f6' listening={false} />
      ))}
    </Group>
  );
}

// ─── Panel de propiedades ─────────────────────────────────────────────────────

function PropertiesPanel({ obj, tags, onChange, onDelete }) {
  if (!obj) return (
    <div style={s.propsEmpty}>
      <div style={{ textAlign: 'center', color: '#475569', marginTop: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⊡</div>
        <div>Seleccioná un objeto</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Click sobre el canvas</div>
      </div>
    </div>
  );

  const meta = TYPE_META[obj.type] || {};

  return (
    <div style={s.propsPanel}>
      {/* Header */}
      <div style={s.propsHeader}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <span style={{ fontWeight: 600 }}>{meta.label}</span>
        <button onClick={onDelete} style={s.deleteBtn} title="Eliminar">✕</button>
      </div>

      <div style={s.propsBody}>
        {/* ID (readonly) */}
        <PropRow label="ID">
          <input style={s.inputReadonly} value={obj.id} readOnly />
        </PropRow>

        {/* Etiqueta */}
        <PropRow label="Etiqueta">
          <input
            style={s.input}
            value={obj.label}
            onChange={e => onChange({ label: e.target.value })}
          />
        </PropRow>

        {/* Tag */}
        <PropRow label="Tag">
          <select
            style={s.select}
            value={obj.tag}
            onChange={e => onChange({ tag: e.target.value })}
          >
            <option value="">— sin tag —</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </PropRow>

        {/* Unidad */}
        <PropRow label="Unidad">
          <input
            style={s.input}
            value={obj.unit || ''}
            onChange={e => onChange({ unit: e.target.value })}
            placeholder="°C, bar, A..."
          />
        </PropRow>

        {/* Posición */}
        <PropRow label="Posición">
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...s.input, width: 50 }} type="number" value={Math.round(obj.x)}
              onChange={e => onChange({ x: Number(e.target.value) })} />
            <input style={{ ...s.input, width: 50 }} type="number" value={Math.round(obj.y)}
              onChange={e => onChange({ y: Number(e.target.value) })} />
          </div>
        </PropRow>

        {/* Tamaño */}
        <PropRow label="Tamaño">
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...s.input, width: 50 }} type="number" value={obj.w}
              onChange={e => onChange({ w: Number(e.target.value) })} />
            <input style={{ ...s.input, width: 50 }} type="number" value={obj.h}
              onChange={e => onChange({ h: Number(e.target.value) })} />
          </div>
        </PropRow>

        {/* Colores */}
        <div style={s.section}>Colores</div>
        <PropRow label="ON">
          <input type="color" value={obj.style.colorOn}
            style={s.colorPicker}
            onChange={e => onChange({ style: { ...obj.style, colorOn: e.target.value } })} />
        </PropRow>
        <PropRow label="OFF">
          <input type="color" value={obj.style.colorOff}
            style={s.colorPicker}
            onChange={e => onChange({ style: { ...obj.style, colorOff: e.target.value } })} />
        </PropRow>
        <PropRow label="Alarma">
          <input type="color" value={obj.style.colorAlarm}
            style={s.colorPicker}
            onChange={e => onChange({ style: { ...obj.style, colorAlarm: e.target.value } })} />
        </PropRow>

        {/* Alarmas */}
        <div style={s.section}>Alarmas</div>
        <PropRow label="Activo">
          <input type="checkbox"
            checked={obj.alarm.enabled}
            onChange={e => onChange({ alarm: { ...obj.alarm, enabled: e.target.checked } })} />
        </PropRow>
        {obj.alarm.enabled && (
          <>
            <PropRow label="Mín">
              <input style={{ ...s.input, width: 70 }} type="number"
                value={obj.alarm.min ?? ''}
                onChange={e => onChange({ alarm: { ...obj.alarm, min: e.target.value === '' ? null : Number(e.target.value) } })} />
            </PropRow>
            <PropRow label="Máx">
              <input style={{ ...s.input, width: 70 }} type="number"
                value={obj.alarm.max ?? ''}
                onChange={e => onChange({ alarm: { ...obj.alarm, max: e.target.value === '' ? null : Number(e.target.value) } })} />
            </PropRow>
            <PropRow label="Nivel">
              <select style={s.select} value={obj.alarm.severity}
                onChange={e => onChange({ alarm: { ...obj.alarm, severity: e.target.value } })}>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </PropRow>
          </>
        )}

        {/* Interacción */}
        <div style={s.section}>Interacción</div>
        <PropRow label="Clickeable">
          <input type="checkbox"
            checked={obj.interaction.clickable}
            onChange={e => onChange({ interaction: { ...obj.interaction, clickable: e.target.checked } })} />
        </PropRow>
        {obj.interaction.clickable && (
          <PropRow label="Comando">
            <select style={s.select} value={obj.interaction.command}
              onChange={e => onChange({ interaction: { ...obj.interaction, command: e.target.value } })}>
              <option value="TOGGLE">TOGGLE</option>
              <option value="SET">SET</option>
              <option value="PULSE">PULSE</option>
            </select>
          </PropRow>
        )}
      </div>
    </div>
  );
}

function PropRow({ label, children }) {
  return (
    <div style={s.propRow}>
      <span style={s.propLabel}>{label}</span>
      <div style={s.propValue}>{children}</div>
    </div>
  );
}

// ─── Paleta de objetos ────────────────────────────────────────────────────────

function ObjectPalette({ activeTool, onSelectTool }) {
  return (
    <div style={s.palette}>
      <div style={s.paletteTitle}>Objetos</div>
      
      {/* Botón Puntero (seleccionar/mover) */}
      <button
        style={{
          ...s.paletteItem,
          background: activeTool === null ? '#3b82f6' + '33' : 'transparent',
          borderColor: activeTool === null ? '#3b82f6' : 'transparent',
          marginBottom: 12,
          minHeight: 50,
        }}
        onClick={() => onSelectTool(null)}
        title='Puntero - Seleccionar y mover objetos'
      >
        <span style={{ fontSize: 18 }}>➤</span>
        <span style={{ fontSize: 11, display: 'block', marginTop: 4 }}>Puntero</span>
      </button>
      
      {OBJECT_CATEGORIES.map(cat => (
        <div key={cat.label}>
          <div style={{ ...s.catLabel, color: cat.color }}>{cat.label}</div>
          {cat.items.map(item => (
            <button
              key={item.type}
              style={{
                ...s.paletteItem,
                background: activeTool === item.type ? cat.color + '33' : 'transparent',
                borderColor: activeTool === item.type ? cat.color : 'transparent',
              }}
              onClick={() => onSelectTool(activeTool === item.type ? null : item.type)}
              title={`Agregar ${item.label} (click en canvas)`}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span style={{ fontSize: 11 }}>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
      {activeTool && (
        <div style={s.toolHint}>
          Click en el canvas para colocar
        </div>
      )}
    </div>
  );
}

// ─── Editor de script WSL (Monaco) ───────────────────────────────────────────

const WSL_KEYWORDS = [
  'ON','END','IF','THEN','ELSE','WHILE','DO','FOR','FROM','TO',
  'STARTUP','SHUTDOWN','INTERVAL','CHANGE','CLICK','ALARM',
  'AND','OR','NOT','TRUE','FALSE','VAR',
];
const WSL_BUILTINS = ['SET','LOG','NOTIFY','CALL','WAIT','READ','MODE','DEVICE','NOW'];

function registerWslLanguage(monaco) {
  monaco.languages.register({ id: 'wsl' });

  monaco.languages.setMonarchTokensProvider('wsl', {
    ignoreCase:  false,
    keywords:    WSL_KEYWORDS,
    builtins:    WSL_BUILTINS,
    tokenizer: {
      root: [
        [/\/\/.*$/,                                              'comment'],
        [/"[^"]*"/,                                             'string'],
        [/\b\d+(\.\d+)?\b/,                                    'number'],
        [/[=!<>+\-*/]+/,                                       'operator'],
        [/[a-zA-Z_][a-zA-Z0-9_.]*/, {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'type.identifier',
            '@default':  'identifier',
          }
        }],
        [/[(),]/,                                               'delimiter'],
      ],
    },
  });

  monaco.editor.defineTheme('wsl-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword',         foreground: '7dd3fc', fontStyle: 'bold' },
      { token: 'type.identifier', foreground: '34d399' },
      { token: 'string',          foreground: 'fbbf24' },
      { token: 'number',          foreground: 'f472b6' },
      { token: 'comment',         foreground: '475569', fontStyle: 'italic' },
      { token: 'operator',        foreground: 'a78bfa' },
    ],
    colors: {
      'editor.background': '#0f172a',
    },
  });
}

function registerWslCompletion(monaco, tags) {
  return monaco.languages.registerCompletionItemProvider('wsl', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      };

      const suggestions = [
        ...WSL_KEYWORDS.map(kw => ({
          label: kw, kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw, range,
        })),
        ...WSL_BUILTINS.map(fn => ({
          label: fn, kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn === 'READ' || fn === 'SET' ? `${fn}("$1", $2)` : `${fn}()`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        ...tags.map(tag => ({
          label: tag, kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `"${tag}"`,
          detail: 'Tag hardware',
          range,
        })),
        // Snippets de estructuras comunes
        {
          label: 'ON INTERVAL',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'ON INTERVAL ${1:5s}\n\t$0\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bloque de intervalo', range,
        },
        {
          label: 'ON CHANGE',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'ON CHANGE "${1:tag}"\n\t$0\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bloque ON CHANGE', range,
        },
        {
          label: 'IF THEN',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'IF ${1:condicion} THEN\n\t$0\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bloque IF', range,
        },
        {
          label: 'IF THEN ELSE',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'IF ${1:condicion} THEN\n\t${2:// si}\nELSE\n\t${3:// sino}\nEND',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Bloque IF/ELSE', range,
        },
      ];
      return { suggestions };
    },
  });
}

function ScriptEditor({ script, onChange, tags, parseError }) {
  const completionRef = useRef(null);

  const handleMount = useCallback((editor, monaco) => {
    registerWslLanguage(monaco);
    if (completionRef.current) completionRef.current.dispose();
    completionRef.current = registerWslCompletion(monaco, tags);
    monaco.editor.setTheme('wsl-dark');
  }, [tags]);

  return (
    <div style={s.scriptArea}>
      <div style={s.scriptHeader}>
        <span style={{ fontWeight: 600, color: '#94a3b8' }}>Script WSL</span>
        {parseError ? (
          <span style={{ color: '#ef4444', fontSize: 11 }}>⚠ {parseError}</span>
        ) : (
          <span style={{ color: '#22c55e', fontSize: 11 }}>✓ Sintaxis correcta</span>
        )}
      </div>
      <MonacoEditor
        height="100%"
        language="wsl"
        theme="wsl-dark"
        value={script}
        onChange={onChange}
        onMount={handleMount}
        options={{
          fontSize: 13,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: 'on',
          automaticLayout: true,
          suggestOnTriggerCharacters: true,
        }}
      />
    </div>
  );
}

// ─── Función de exportación .scada ───────────────────────────────────────────

function buildScadaFile({ hardware, screens, script, author = 'Usuario' }) {
  const now = new Date().toISOString();
  const hwId = hardware?.device?.id || 'device-01';

  const hwJson = hardware
    ? JSON.stringify(hardware, null, 2)
    : JSON.stringify({ device: { id: hwId } }, null, 2);

  const designJson = JSON.stringify({ screens }, null, 2);

  return [
    '##SCADA_FILE_V1',
    `##CREATED: ${now}`,
    `##AUTHOR: ${author}`,
    `##DESCRIPTION: Proyecto SCADA`,
    '',
    '[HARDWARE]',
    hwJson,
    '',
    '[DESIGN]',
    designJson,
    '',
    '[SCRIPT]',
    script,
  ].join('\n');
}

// ─── Parser del archivo .scada (cargar desde disco) ──────────────────────────

function parseScadaFile(text) {
  const hwMatch     = text.match(/\[HARDWARE\]([\s\S]*?)(?=\[DESIGN\]|\[SCRIPT\]|$)/);
  const designMatch = text.match(/\[DESIGN\]([\s\S]*?)(?=\[SCRIPT\]|$)/);
  const scriptMatch = text.match(/\[SCRIPT\]([\s\S]*?)$/);

  let hardware = null, screens = [createEmptyScreen()], script = DEFAULT_SCRIPT;

  try { hardware = JSON.parse(hwMatch?.[1]?.trim() || 'null'); } catch {}
  try {
    const d = JSON.parse(designMatch?.[1]?.trim() || '{}');
    if (d.screens?.length) screens = d.screens;
  } catch {}
  if (scriptMatch) script = scriptMatch[1].trim();

  return { hardware, screens, script };
}

// ─── Estado inicial ───────────────────────────────────────────────────────────

function createEmptyScreen(id = 'pantalla-1') {
  return { id, name: 'Pantalla 1', width: 1280, height: 720, background: '#0f172a', objects: [] };
}

const DEFAULT_SCRIPT = `// Script WSL — edita la lógica de tu SCADA aquí
// Usá Ctrl+Space para autocompletar tags y comandos

// Variables globales
VAR paso = 0
VAR t_inicio = 0

ON STARTUP
  SET(ReleMotor1.OFF)
  SET(ReleMotor2.OFF)
  SET(ReleMotor3.OFF)
  SET(paso, 0)
  LOG("Iniciando secuencia de motores...")
  SET(ReleMotor1.ON)
  SET(paso, 1)
  SET(t_inicio, NOW)
END

ON INTERVAL 1s
  IF paso == 1 AND (NOW - t_inicio) >= 3 THEN
    SET(ReleMotor2.ON)
    SET(paso, 2)
    SET(t_inicio, NOW)
    LOG("Motor 2 encendido")
  END
  IF paso == 2 AND (NOW - t_inicio) >= 3 THEN
    SET(ReleMotor3.ON)
    SET(paso, 3)
    LOG("Motor 3 encendido — secuencia completa")
  END
END
`;

// ─── Validación WSL (usa el parser de F4 si está disponible) ─────────────────

async function validateScript(scriptText) {
  try {
    // Importación dinámica del parser F4
    const { WslParser }    = await import('../../engine/WslParser.js');
    const { WslParseError } = await import('../../engine/WslErrors.js');
    try {
      new WslParser(scriptText).parse();
      return null;
    } catch (e) {
      if (e?.wslMessage) return e.message;
      return String(e);
    }
  } catch {
    // Parser no disponible en este entorno
    return null;
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ScadaEditor() {
  const { currentProject, setScreens: saveScreens, setScript: saveScript, setHardware: saveHardware, saveProject } = useScadaStore();

  // Estado del proyecto — inicializado desde el store
  const [screens,        setScreens]       = useState(() =>
    currentProject.screens?.length ? currentProject.screens : [createEmptyScreen()]
  );
  const [activeScreenId, setActiveScreenId]= useState(() =>
    currentProject.screens?.[0]?.id ?? 'pantalla-1'
  );
  const [script,         setScript]        = useState(currentProject.script || DEFAULT_SCRIPT);
  const hardware = currentProject.hardware;

  // Estado del editor
  const [selectedId,  setSelectedId]  = useState(null);
  const [activeTool,  setActiveTool]  = useState(null);  // tipo a colocar
  const [mode,        setMode]        = useState('design'); // 'design' | 'runtime'
  const [scriptError, setScriptError] = useState(null);
  const [layout,      setLayout]      = useState('canvas'); // 'canvas' | 'script' | 'split'
  const [showScript,  setShowScript]  = useState(false);    // el editor WSL está oculto por defecto

  const stageRef    = useRef(null);
  const fileInputRef = useRef(null);
  const runtimeRef  = useRef(null);

  // Tags disponibles desde el hardware
  const tags = useMemo(() => generateTags(hardware), [hardware]);

  // Valores en vivo de tags (modo runtime)
  const [tagValues, setTagValues] = useState({}); // { [tag]: value }
  const [runtimeMode, setRuntimeMode] = useState('SIMULATION'); // modo de transporte activo
  const [runtimeLog, setRuntimeLog] = useState([]);

  // Pantalla activa
  const activeScreen = screens.find(sc => sc.id === activeScreenId) || screens[0];

  // ── Persistir screens y script al store con debounce ─────────────────────

  useEffect(() => {
    const t = setTimeout(() => saveScreens(screens), 400);
    return () => clearTimeout(t);
  }, [screens]);

  useEffect(() => {
    const t = setTimeout(() => saveScript(script), 400);
    return () => clearTimeout(t);
  }, [script]);

  // ── Validación del script al cambiar ─────────────────────────────────────

  useEffect(() => {
    const timeout = setTimeout(async () => {
      const err = await validateScript(script);
      setScriptError(err);
    }, 800);
    return () => clearTimeout(timeout);
  }, [script]);

  // ── Runtime: arrancar/parar al cambiar modo ──────────────────────────────

  useEffect(() => {
    if (mode !== 'runtime') {
      // Parar runtime si existe
      if (runtimeRef.current) {
        runtimeRef.current.stop().catch(() => {});
        runtimeRef.current = null;
      }
      setTagValues({});
      setRuntimeLog([]);
      return;
    }

    if (!hardware || !script) return;

    const rt = new WslRuntime({
      hardware,
      script,
      design: { screens },
      transportMode: hardware?.device?.mode || 'SIMULATION',
    });

    rt.onTagChange = (tag, value) => {
      setTagValues(prev => ({ ...prev, [tag]: value }));
    };

    rt.onLog = ({ msg }) => {
      setRuntimeLog(prev => [...prev.slice(-49), msg]);
    };

    rt.onAlarm = ({ message, level }) => {
      setRuntimeLog(prev => [...prev.slice(-49), `[${level}] ${message}`]);
    };

    rt.onError = (err) => {
      setRuntimeLog(prev => [...prev.slice(-49), `❌ ${err.message}`]);
    };

    runtimeRef.current = rt;

    rt.start()
      .then(() => setRuntimeMode(rt.getMode()))
      .catch(err => {
        setRuntimeLog(prev => [...prev, `❌ No se pudo iniciar: ${err.message}`]);
        setMode('design');
      });

    return () => {
      rt.stop().catch(() => {});
      runtimeRef.current = null;
    };
  }, [mode]); // solo reacciona al cambio de modo, no a cambios del script/hardware en vivo

  // ── Helpers de pantallas ──────────────────────────────────────────────────

  const updateScreen = useCallback((screenId, patch) => {
    setScreens(prev => prev.map(sc =>
      sc.id === screenId ? { ...sc, ...patch } : sc
    ));
  }, []);

  const updateObjects = useCallback((screenId, newObjects) => {
    updateScreen(screenId, { objects: newObjects });
  }, [updateScreen]);

  // ── Agregar pantalla ──────────────────────────────────────────────────────

  const addScreen = useCallback(() => {
    const id = `pantalla-${Date.now()}`;
    const newScreen = createEmptyScreen(id);
    newScreen.name = `Pantalla ${screens.length + 1}`;
    setScreens(prev => [...prev, newScreen]);
    setActiveScreenId(id);
    setSelectedId(null);
  }, [screens.length]);

  // ── Click en canvas: coloca objeto si hay herramienta activa ─────────────

  const handleStageClick = useCallback((e) => {
    // Solo procesar eventos del Stage, no de sus hijos
    if (e.target !== e.target.getStage()) return;
    
    if (activeTool) {
      // Colocar nuevo objeto
      const stage = e.target.getStage();
      const pos   = stage.getPointerPosition();
      const obj   = makeObject(activeTool, Math.round(pos.x - 36), Math.round(pos.y - 36), activeScreen.objects);
      updateObjects(activeScreenId, [...activeScreen.objects, obj]);
      setSelectedId(obj.id);
      setActiveTool(null); // Resetear herramienta después de colocar
    } else {
      // Deseleccionar si no hay herramienta activa
      setSelectedId(null);
    }
  }, [activeTool, activeScreenId, activeScreen.objects, updateObjects]);

  // ── Mover objeto ──────────────────────────────────────────────────────────

  const handleObjectDragEnd = useCallback((id, pos) => {
    updateObjects(activeScreenId, activeScreen.objects.map(o =>
      o.id === id ? { ...o, x: Math.round(pos.x), y: Math.round(pos.y) } : o
    ));
  }, [activeScreenId, activeScreen.objects, updateObjects]);

  // ── Editar propiedades del objeto seleccionado ────────────────────────────

  const selectedObj = activeScreen.objects.find(o => o.id === selectedId) || null;

  const handlePropChange = useCallback((patch) => {
    updateObjects(activeScreenId, activeScreen.objects.map(o =>
      o.id === selectedId ? { ...o, ...patch } : o
    ));
  }, [selectedId, activeScreenId, activeScreen.objects, updateObjects]);

  const handleDeleteSelected = useCallback(() => {
    updateObjects(activeScreenId, activeScreen.objects.filter(o => o.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, activeScreenId, activeScreen.objects, updateObjects]);

  // ── Guardar proyecto al store (flush inmediato + snapshot) ───────────────

  const handleSave = useCallback(() => {
    saveScreens(screens);
    saveScript(script);
    saveProject();
  }, [screens, script, saveScreens, saveScript, saveProject]);

  // ── Exportar .scada ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const text = buildScadaFile({ hardware, screens, script });
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${hardware?.device?.id || 'proyecto'}.scada`;
    a.click();
    URL.revokeObjectURL(url);
  }, [hardware, screens, script]);

  // ── Cargar .scada desde disco ─────────────────────────────────────────────

  const handleLoad = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { hardware: hw, screens: sc, script: wsl } = parseScadaFile(ev.target.result);
      if (hw)  saveHardware(hw);
      if (sc)  setScreens(sc);
      if (wsl) setScript(wsl);
      setActiveScreenId(sc?.[0]?.id || 'pantalla-1');
      setSelectedId(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── Nuevo proyecto ────────────────────────────────────────────────────────

  const handleNew = useCallback(() => {
    if (!window.confirm('¿Nuevo proyecto? Se perderán los cambios no guardados.')) return;
    setScreens([createEmptyScreen()]);
    setActiveScreenId('pantalla-1');
    setScript(DEFAULT_SCRIPT);
    setSelectedId(null);
  }, []);

  // ── Teclas ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
           selectedId && document.activeElement.tagName !== 'INPUT' &&
           document.activeElement.tagName !== 'TEXTAREA') {
        handleDeleteSelected();
      }
      if (e.key === 'Escape') { setActiveTool(null); setSelectedId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, handleDeleteSelected]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const canvasW = activeScreen.width  || 1280;
  const canvasH = activeScreen.height || 720;

  return (
    <div style={s.root}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          <span style={s.logo}>⚡ ScadaEditor</span>
          <button style={s.tbBtn} onClick={handleNew}        title="Nuevo proyecto">Nuevo</button>
          <button style={s.tbBtn} onClick={() => fileInputRef.current.click()} title="Cargar .scada">Abrir</button>
          <input ref={fileInputRef} type="file" accept=".scada,.txt" style={{ display: 'none' }} onChange={handleLoad} />
          <button style={{ ...s.tbBtn, ...s.tbBtnPrimary }} onClick={handleSave}>💾 Guardar</button>
          <button style={s.tbBtn} onClick={handleExport}>Exportar .scada</button>
        </div>

        {/* Tabs de pantallas */}
        <div style={s.screenTabs}>
          {screens.map(sc => (
            <button
              key={sc.id}
              style={{ ...s.screenTab, ...(sc.id === activeScreenId ? s.screenTabActive : {}) }}
              onClick={() => { setActiveScreenId(sc.id); setSelectedId(null); }}
            >
              {sc.name}
            </button>
          ))}
          <button style={s.screenTabAdd} onClick={addScreen} title="Nueva pantalla">+</button>
        </div>

        {/* Modo + layout */}
        <div style={s.toolbarRight}>
          <div style={s.modeToggle}>
            <button
              style={{ ...s.modeBtn, ...(mode === 'design' ? s.modeBtnActive : {}) }}
              onClick={() => setMode('design')}>
              ✏ Diseño
            </button>
            <button
              style={{
                ...s.modeBtn,
                ...(mode === 'runtime' ? { background: '#16a34a', color: '#fff' } : {}),
              }}
              onClick={() => setMode(mode === 'runtime' ? 'design' : 'runtime')}>
              {mode === 'runtime' ? '⏹ Detener' : '▶ Runtime'}
            </button>
          </div>
          {/* Botón para mostrar/ocultar el editor WSL de script */}
          <button
            title={showScript ? 'Ocultar editor WSL' : 'Mostrar editor WSL'}
            onClick={() => setShowScript(v => !v)}
            style={{
              ...s.modeBtn,
              border: '1px solid #334155',
              borderRadius: 5,
              background: showScript ? '#1e3a5f' : 'transparent',
              color: showScript ? '#38bdf8' : '#64748b',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {showScript ? '✕' : '{ }'} Script WSL
            {scriptError && (
              <span style={{ color: '#ef4444', fontSize: 10, marginLeft: 2 }}>⚠</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Cuerpo principal ─────────────────────────────────────────────── */}
      <div style={s.body}>

        {/* Paleta (solo en modo diseño) */}
        {mode === 'design' && (
          <ObjectPalette activeTool={activeTool} onSelectTool={setActiveTool} />
        )}

        {/* Canvas */}
        {(layout === 'canvas' || layout === 'split') && (
          <div style={{ ...s.canvasWrapper, cursor: activeTool ? 'crosshair' : 'default' }}>
            <Stage
              ref={stageRef}
              width={canvasW}
              height={canvasH}
              style={{ background: activeScreen.background || '#0f172a' }}
              onClick={mode === 'design' ? handleStageClick : undefined}
            >
              <Layer>
                {activeScreen.objects.map(obj => (
                  <CanvasObject
                    key={obj.id}
                    obj={obj}
                    selected={selectedId === obj.id}
                    isRuntime={mode === 'runtime'}
                    tagValue={obj.tag ? tagValues[obj.tag] : undefined}
                    onSelect={mode === 'design' ? setSelectedId : undefined}
                    onDragEnd={mode === 'design' ? handleObjectDragEnd : undefined}
                    onRuntimeClick={mode === 'runtime' ? (id) => runtimeRef.current?.emitClick(id) : undefined}
                  />
                ))}
              </Layer>
            </Stage>
            {activeScreen.objects.length === 0 && mode === 'design' && (
              <div style={s.canvasHint}>
                {activeTool
                  ? `Click para colocar: ${TYPE_META[activeTool]?.label}`
                  : 'Seleccioná un objeto de la paleta y hacé click aquí'}
              </div>
            )}
            {/* Barra de estado runtime */}
            {mode === 'runtime' && (
              <div style={s.runtimeBar}>
                <span style={{ color: '#22c55e', fontWeight: 600 }}>▶ Runtime</span>
                <span style={{ color: '#64748b' }}>{runtimeMode}</span>
                {runtimeLog.length > 0 && (
                  <span style={{ color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {runtimeLog[runtimeLog.length - 1]}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Script editor — visible solo si el usuario lo activa con el botón */}
        {showScript && mode === 'design' && (
          <ScriptEditor
            script={script}
            onChange={setScript}
            tags={tags}
            parseError={scriptError}
          />
        )}

        {/* Panel de propiedades (solo diseño) */}
        {mode === 'design' && (
          <PropertiesPanel
            obj={selectedObj}
            tags={tags}
            onChange={handlePropChange}
            onDelete={handleDeleteSelected}
          />
        )}
      </div>
    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100%',
    background: '#0f172a', color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 13, overflow: 'hidden',
  },
  // Toolbar
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1e293b', borderBottom: '1px solid #334155',
    padding: '0 12px', height: 44, flexShrink: 0,
  },
  toolbarLeft:  { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  toolbarRight: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  logo: { fontWeight: 700, fontSize: 15, color: '#38bdf8', marginRight: 8, letterSpacing: -0.5 },
  tbBtn: {
    background: 'transparent', border: '1px solid #334155', borderRadius: 5,
    color: '#94a3b8', padding: '3px 10px', cursor: 'pointer', fontSize: 12,
  },
  tbBtnPrimary: { background: '#0ea5e9', border: 'none', color: '#fff', fontWeight: 600 },
  // Pantallas
  screenTabs: { display: 'flex', alignItems: 'center', gap: 2, flex: 1, overflow: 'hidden' },
  screenTab: {
    background: 'transparent', border: '1px solid transparent', borderRadius: '5px 5px 0 0',
    color: '#64748b', padding: '4px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
  },
  screenTabActive: { background: '#0f172a', border: '1px solid #334155', borderBottom: '1px solid #0f172a', color: '#e2e8f0' },
  screenTabAdd: {
    background: 'transparent', border: '1px dashed #334155', borderRadius: 5,
    color: '#64748b', padding: '2px 8px', cursor: 'pointer', fontSize: 16,
  },
  // Modo
  modeToggle: { display: 'flex', border: '1px solid #334155', borderRadius: 6, overflow: 'hidden' },
  modeBtn: {
    background: 'transparent', border: 'none', color: '#64748b',
    padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },
  modeBtnActive: { background: '#334155', color: '#e2e8f0' },
  // Cuerpo
  body: { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 },
  // Paleta
  palette: {
    width: 130, flexShrink: 0, background: '#1e293b',
    borderRight: '1px solid #334155', overflowY: 'auto', padding: '8px 0',
  },
  paletteTitle: { fontWeight: 600, color: '#64748b', fontSize: 11, padding: '4px 10px 6px', textTransform: 'uppercase', letterSpacing: 0.8 },
  catLabel: { fontSize: 10, fontWeight: 600, padding: '6px 10px 2px', textTransform: 'uppercase', letterSpacing: 0.5 },
  paletteItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', background: 'transparent', border: '1px solid transparent',
    borderRadius: 5, padding: '5px 10px', cursor: 'pointer',
    color: '#cbd5e1', textAlign: 'left', margin: '1px 0',
    transition: 'background 0.15s',
  },
  toolHint: {
    margin: 8, padding: '6px 8px', background: '#0ea5e920',
    border: '1px solid #0ea5e940', borderRadius: 5,
    color: '#7dd3fc', fontSize: 10, textAlign: 'center',
  },
  // Canvas
  canvasWrapper: {
    flex: 1, overflow: 'auto', position: 'relative',
    background: '#0a0f1a',
  },
  canvasHint: {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#1e293b', fontSize: 14, pointerEvents: 'none',
    border: '2px dashed #1e293b', borderRadius: 12, padding: '20px 32px',
    textAlign: 'center',
  },
  runtimeBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 28, background: '#0a1628cc', backdropFilter: 'blur(4px)',
    borderTop: '1px solid #1e3a5f',
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '0 12px', fontSize: 11, fontFamily: 'monospace',
    pointerEvents: 'none',
  },
  // Script
  scriptArea: {
    display: 'flex', flexDirection: 'column',
    width: 420, flexShrink: 0,
    borderLeft: '1px solid #334155',
    minHeight: 0,
    overflow: 'hidden',
  },
  scriptHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 12px', background: '#1e293b', borderBottom: '1px solid #334155',
    flexShrink: 0, height: 32,
  },
  // Properties panel
  propsEmpty: {
    width: 220, flexShrink: 0, background: '#1e293b',
    borderLeft: '1px solid #334155',
  },
  propsPanel: {
    width: 220, flexShrink: 0, background: '#1e293b',
    borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  propsHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px', background: '#263346',
    borderBottom: '1px solid #334155', flexShrink: 0,
  },
  deleteBtn: {
    marginLeft: 'auto', background: 'transparent', border: 'none',
    color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 4px',
  },
  propsBody: { flex: 1, overflowY: 'auto', padding: 8 },
  propRow: { display: 'flex', alignItems: 'center', marginBottom: 5, gap: 4 },
  propLabel: { width: 56, flexShrink: 0, color: '#64748b', fontSize: 11 },
  propValue: { flex: 1 },
  section: {
    color: '#475569', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 0.8, margin: '10px 0 4px', borderBottom: '1px solid #1e293b',
    paddingBottom: 3,
  },
  input: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 4,
    color: '#e2e8f0', padding: '3px 6px', fontSize: 12, width: '100%', boxSizing: 'border-box',
  },
  inputReadonly: {
    background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 4,
    color: '#475569', padding: '3px 6px', fontSize: 11, width: '100%', boxSizing: 'border-box',
  },
  select: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 4,
    color: '#e2e8f0', padding: '3px 4px', fontSize: 12, width: '100%',
  },
  colorPicker: {
    width: 40, height: 24, padding: 0, border: '1px solid #334155',
    borderRadius: 4, background: 'none', cursor: 'pointer',
  },
};
