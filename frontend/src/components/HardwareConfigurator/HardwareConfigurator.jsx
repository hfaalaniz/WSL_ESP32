import { useState, useEffect } from "react";
import { generateTagsWithMetadata } from "../../utils/tagGenerator.js";
import { useScadaStore } from "../../store/scadaStore.js";

// ── Constantes ──────────────────────────────────────────────────────────────
const RESERVED_PINS = [1, 3];
const INPUT_ONLY_PINS = [34, 35, 36, 39];
const ALL_GPIOS = [2,4,5,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,32,33,34,35,36,39];
const OUTPUT_GPIOS = ALL_GPIOS.filter(p => !INPUT_ONLY_PINS.includes(p));

const IC_CONFIGS = {
  ic595: {
    label: "74HC595",
    sublabel: "Salidas digitales",
    color: "#00d4aa",
    icon: "▶",
    max: 8,
    pinsNeeded: ["data", "clock", "latch"],
    pinLabels: { data: "DATA", clock: "CLOCK", latch: "LATCH" },
    outputOnly: true,
    description: "Expansión de salidas digitales en cascada (8 por IC)"
  },
  ic165: {
    label: "74HC165",
    sublabel: "Entradas digitales",
    color: "#4d9fff",
    icon: "◀",
    max: 8,
    pinsNeeded: ["data", "clock", "load"],
    pinLabels: { data: "DATA", clock: "CLOCK", load: "LOAD" },
    outputOnly: false,
    description: "Expansión de entradas digitales en cascada (8 por IC)"
  },
  ads1115: {
    label: "ADS1115",
    sublabel: "Entradas analógicas 16-bit",
    color: "#f59e0b",
    icon: "〜",
    max: 4,
    pinsNeeded: ["sda", "scl"],
    pinLabels: { sda: "SDA", scl: "SCL" },
    outputOnly: false,
    description: "Conversor ADC de alta precisión, 4 canales por IC (I2C)"
  },
  mcp23017: {
    label: "MCP23017",
    sublabel: "I/O digitales I2C",
    color: "#a78bfa",
    icon: "⇄",
    max: 8,
    pinsNeeded: ["sda", "scl"],
    pinLabels: { sda: "SDA", scl: "SCL" },
    outputOnly: false,
    description: "Expansión de 16 I/O digitales por I2C (16 por IC)"
  }
};

const ADS_ADDRS = ["0x48", "0x49", "0x4A", "0x4B"];
const MCP_ADDRS = ["0x20", "0x21", "0x22", "0x23", "0x24", "0x25", "0x26", "0x27"];

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateTags(hw) {
  return generateTagsWithMetadata(hw);
}

function getPinConflicts(hw) {
  const used = {};
  const conflicts = [];
  const addPin = (gpio, source) => {
    if (RESERVED_PINS.includes(gpio)) {
      conflicts.push({ pin: gpio, msg: `GPIO${gpio} es reservado (UART)` });
      return;
    }
    if (used[gpio] && used[gpio] !== source) {
      const existing = used[gpio];
      // SPI compartido es válido entre 595/165
      if (!((existing.includes("595") || existing.includes("165")) && (source.includes("595") || source.includes("165")) && gpio !== used[gpio + "_latch"])) {
        conflicts.push({ pin: gpio, msg: `GPIO${gpio} usado en ${existing} y ${source}` });
      }
    }
    used[gpio] = source;
  };

  hw.native.digital_in.forEach(p => addPin(p.gpio, "DIN"));
  hw.native.digital_out.forEach(p => addPin(p.gpio, "DOUT"));
  hw.native.analog_in.forEach(p => addPin(p.gpio, "AIN"));
  hw.native.pwm_out.forEach(p => addPin(p.gpio, "PWM"));

  const exp = hw.expansion;
  if (exp.ic595.enabled) {
    Object.entries(exp.ic595.pins).forEach(([k, v]) => v && addPin(v, `595.${k}`));
    if (exp.ic595.pins.latch) used[exp.ic595.pins.latch + "_latch"] = "595";
  }
  if (exp.ic165.enabled)
    Object.entries(exp.ic165.pins).forEach(([k, v]) => v && addPin(v, `165.${k}`));
  if (exp.ads1115.enabled)
    Object.entries(exp.ads1115.pins).forEach(([k, v]) => v && addPin(v, `ADS.${k}`));
  if (exp.mcp23017.enabled)
    Object.entries(exp.mcp23017.pins).forEach(([k, v]) => v && addPin(v, `MCP.${k}`));

  return conflicts;
}

function buildScadaHeader(hw) {
  const tags = generateTags(hw);
  const din = tags.filter(t => t.dir === "IN").length;
  const dout = tags.filter(t => t.dir === "OUT").length;
  const now = new Date().toISOString();
  return `##SCADA_FILE_V1\n##CREATED: ${now}\n##AUTHOR: \n##DESCRIPTION: \n\n[HARDWARE]\n${JSON.stringify(hw, null, 2)}\n\n[DESIGN]\n{}\n\n[SCRIPT]\nON STARTUP\n    LOG("Sistema iniciado - ${din} entradas, ${dout} salidas")\nEND\n`;
}

// ── Estado inicial ────────────────────────────────────────────────────────────
const initHW = () => ({
  device: { id: "", name: "", description: "", mode: "AUTO",
    connection: { local: { port: "COM3", baud: 115200 }, remote: { ip: "", port: 80, timeout_ms: 3000 } } },
  native: { digital_in: [], digital_out: [], analog_in: [], pwm_out: [] },
  expansion: {
    ic595:    { enabled: false, count: 0, pins: { data: "", clock: "", latch: "" }, outputs: [] },
    ic165:    { enabled: false, count: 0, pins: { data: "", clock: "", load: "" }, inputs: [] },
    ads1115:  { enabled: false, count: 0, pins: { sda: "", scl: "" }, devices: [] },
    mcp23017: { enabled: false, count: 0, pins: { sda: "", scl: "" }, devices: [] }
  }
});

// ── Componentes ───────────────────────────────────────────────────────────────
function PinBadge({ gpio, used }) {
  const isRes = RESERVED_PINS.includes(gpio);
  const isIO  = INPUT_ONLY_PINS.includes(gpio);
  const isUsed = used.includes(gpio);
  const color = isRes ? "#ef4444" : isUsed ? "#f59e0b" : isIO ? "#60a5fa" : "#00d4aa";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 36, height: 36, borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: isUsed || isRes ? color + "22" : "#1a2035",
      border: `1.5px solid ${color}`, color,
      cursor: isRes ? "not-allowed" : "default",
      fontFamily: "'JetBrains Mono', monospace"
    }}>
      {gpio}
    </span>
  );
}

function SectionHeader({ title, sub, color, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <span style={{
        width: 36, height: 36, borderRadius: 8, background: color + "22",
        border: `1.5px solid ${color}`, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 16, color
      }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>{sub}</div>
      </div>
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 12, padding: 20, marginBottom: 16, ...style
    }}>{children}</div>
  );
}

function Select({ value, onChange, options, style = {} }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
      color: "#e2e8f0", padding: "6px 10px", fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace", ...style
    }}>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  );
}

function Input({ value, onChange, placeholder, style = {} }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{
      background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
      color: "#e2e8f0", padding: "6px 10px", fontSize: 12, outline: "none",
      fontFamily: "'JetBrains Mono', monospace", ...style
    }} />
  );
}

function CountSelector({ value, max, onChange, color }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: max + 1 }, (_, i) => (
        <button key={i} onClick={() => onChange(i)} style={{
          width: 32, height: 32, borderRadius: 6, border: `1.5px solid ${i === value ? color : "#334155"}`,
          background: i === value ? color + "22" : "#1e293b",
          color: i === value ? color : "#64748b",
          fontWeight: 700, fontSize: 12, cursor: "pointer",
          fontFamily: "'JetBrains Mono', monospace"
        }}>{i}</button>
      ))}
    </div>
  );
}

function NativeIOSection({ hw, setHW }) {
  const usedPins = [
    ...hw.native.digital_in.map(p => p.gpio),
    ...hw.native.digital_out.map(p => p.gpio),
    ...hw.native.analog_in.map(p => p.gpio),
    ...hw.native.pwm_out.map(p => p.gpio),
  ];

  const addPin = (section, gpio, outputOnly = false) => {
    if (RESERVED_PINS.includes(gpio)) return;
    if (outputOnly && INPUT_ONLY_PINS.includes(gpio)) return;
    if (usedPins.includes(gpio)) return;
    setHW(h => {
      const n = { ...h.native };
      n[section] = [...n[section], { gpio, label: "", pull: "NONE", default: 0, resolution: 12, freq_hz: 1000 }];
      return { ...h, native: n };
    });
  };

  const removePin = (section, gpio) => {
    setHW(h => {
      const n = { ...h.native };
      n[section] = n[section].filter(p => p.gpio !== gpio);
      return { ...h, native: n };
    });
  };

  const rows = [
    { key: "digital_in",  label: "Digital IN",  color: "#4d9fff", gpios: ALL_GPIOS, icon: "↓" },
    { key: "digital_out", label: "Digital OUT", color: "#00d4aa", gpios: OUTPUT_GPIOS, icon: "↑" },
    { key: "analog_in",   label: "Analog IN",   color: "#f59e0b", gpios: [32,33,34,35], icon: "〜" },
    { key: "pwm_out",     label: "PWM OUT",     color: "#a78bfa", gpios: OUTPUT_GPIOS, icon: "⊓" },
  ];

  return (
    <Card>
      <SectionHeader title="I/O Nativa ESP32" sub="GPIOs disponibles del microcontrolador" color="#00d4aa" icon="⚡" />
      {rows.map(row => (
        <div key={row.key} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: row.color, fontWeight: 700, marginBottom: 8, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>
            {row.icon} {row.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {row.gpios.map(gpio => {
              const used = usedPins.includes(gpio);
              const reserved = RESERVED_PINS.includes(gpio);
              return (
                <button key={gpio} onClick={() => !used && !reserved && addPin(row.key, gpio)}
                  style={{
                    width: 36, height: 36, borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: reserved ? "#ef444422" : used ? row.color + "22" : "#1e293b",
                    border: `1.5px solid ${reserved ? "#ef4444" : used ? row.color : "#334155"}`,
                    color: reserved ? "#ef4444" : used ? row.color : "#475569",
                    cursor: reserved || used ? "not-allowed" : "pointer",
                    fontFamily: "'JetBrains Mono', monospace"
                  }}>{gpio}</button>
              );
            })}
          </div>
          {hw.native[row.key].length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {hw.native[row.key].map(p => (
                <div key={p.gpio} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
                  background: row.color + "11", border: `1px solid ${row.color}44`,
                  borderRadius: 6
                }}>
                  <span style={{ fontSize: 11, color: row.color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>GPIO{p.gpio}</span>
                  <Input value={p.label} onChange={v => setHW(h => {
                    const n = { ...h.native };
                    n[row.key] = n[row.key].map(x => x.gpio === p.gpio ? { ...x, label: v } : x);
                    return { ...h, native: n };
                  })} placeholder="etiqueta" style={{ width: 90, padding: "2px 6px" }} />
                  <button onClick={() => removePin(row.key, p.gpio)} style={{
                    background: "none", border: "none", color: "#ef4444",
                    cursor: "pointer", fontSize: 14, lineHeight: 1
                  }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function ExpansionIC({ icKey, hw, setHW }) {
  const cfg = IC_CONFIGS[icKey];
  const exp = hw.expansion[icKey];

  const toggle = () => setHW(h => ({
    ...h, expansion: { ...h.expansion, [icKey]: { ...h.expansion[icKey], enabled: !exp.enabled, count: 0 } }
  }));

  const setCount = (count) => {
    setHW(h => {
      const prev = h.expansion[icKey];
      let updates = { count };
      if (icKey === "ic595") {
        const outputs = Array.from({ length: count * 8 }, (_, i) =>
          prev.outputs[i] || { index: i, label: `OUT ${i}`, default: 0 });
        updates.outputs = outputs;
      }
      if (icKey === "ic165") {
        const inputs = Array.from({ length: count * 8 }, (_, i) =>
          prev.inputs[i] || { index: i, label: `IN ${i}` });
        updates.inputs = inputs;
      }
      if (icKey === "ads1115") {
        const devices = Array.from({ length: count }, (_, i) =>
          prev.devices[i] || {
            index: i, addr: ADS_ADDRS[i],
            channels: [0, 1, 2, 3].map(ch => ({ ch, label: `ADS${i} CH${ch}`, gain: 1, unit: "", scale_min: 0, scale_max: 100 }))
          });
        updates.devices = devices;
      }
      if (icKey === "mcp23017") {
        const devices = Array.from({ length: count }, (_, i) =>
          prev.devices[i] || { index: i, addr: MCP_ADDRS[i] });
        updates.devices = devices;
      }
      return { ...h, expansion: { ...h.expansion, [icKey]: { ...prev, ...updates } } };
    });
  };

  const setPin = (pinKey, val) => setHW(h => ({
    ...h, expansion: { ...h.expansion, [icKey]: { ...h.expansion[icKey], pins: { ...h.expansion[icKey].pins, [pinKey]: parseInt(val) || val } } }
  }));

  const totalChannels = () => {
    if (icKey === "ic595" || icKey === "ic165") return exp.count * 8;
    if (icKey === "ads1115") return exp.count * 4;
    if (icKey === "mcp23017") return exp.count * 16;
    return 0;
  };

  return (
    <Card style={{ border: exp.enabled ? `1px solid ${cfg.color}33` : "1px solid #1e293b" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: exp.enabled ? 16 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 6,
            background: exp.enabled ? cfg.color + "22" : "#1e293b",
            border: `1.5px solid ${exp.enabled ? cfg.color : "#334155"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: exp.enabled ? cfg.color : "#475569"
          }}>{cfg.icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: exp.enabled ? "#e2e8f0" : "#475569", fontFamily: "'JetBrains Mono', monospace" }}>{cfg.label}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>{cfg.sublabel}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {exp.enabled && exp.count > 0 && (
            <span style={{ fontSize: 11, color: cfg.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
              {totalChannels()} canales
            </span>
          )}
          <button onClick={toggle} style={{
            width: 44, height: 24, borderRadius: 12,
            background: exp.enabled ? cfg.color : "#1e293b",
            border: `1.5px solid ${exp.enabled ? cfg.color : "#334155"}`,
            cursor: "pointer", position: "relative", transition: "all 0.2s"
          }}>
            <span style={{
              position: "absolute", top: 3, width: 16, height: 16, borderRadius: "50%",
              background: "#fff", transition: "all 0.2s",
              left: exp.enabled ? 24 : 4
            }} />
          </button>
        </div>
      </div>

      {exp.enabled && (
        <div style={{ borderTop: `1px solid ${cfg.color}22`, paddingTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>CANTIDAD DE ICs</div>
            <CountSelector value={exp.count} max={cfg.max} onChange={setCount} color={cfg.color} />
          </div>

          {exp.count > 0 && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>PINES</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {cfg.pinsNeeded.map(pk => (
                    <div key={pk} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: cfg.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, minWidth: 40 }}>{cfg.pinLabels[pk]}</span>
                      <Select
                        value={exp.pins[pk] || ""}
                        onChange={v => setPin(pk, v)}
                        options={[{ value: "", label: "—" }, ...OUTPUT_GPIOS.map(g => ({ value: g, label: `GPIO${g}` }))]}
                        style={{ minWidth: 90 }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {(icKey === "ads1115" || icKey === "mcp23017") && exp.devices.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>DIRECCIONES I2C</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {exp.devices.map((d, i) => (
                      <span key={i} style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: cfg.color + "22", border: `1px solid ${cfg.color}44`,
                        color: cfg.color, fontFamily: "'JetBrains Mono', monospace"
                      }}>IC{i}: {d.addr}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function TagTree({ tags }) {
  const groups = tags.reduce((acc, t) => {
    const key = t.tag.split(".")[1];
    acc[key] = acc[key] || [];
    acc[key].push(t);
    return acc;
  }, {});

  const dirColor = { IN: "#4d9fff", OUT: "#00d4aa", IO: "#a78bfa" };

  return (
    <div style={{ maxHeight: 400, overflowY: "auto" }}>
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{group}</div>
          {items.map(t => (
            <div key={t.tag} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 8px", borderRadius: 4, marginBottom: 2,
              background: "#0a0f1e"
            }}>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>{t.tag}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#475569" }}>{t.type}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                  background: dirColor[t.dir] + "22", color: dirColor[t.dir],
                  fontFamily: "'JetBrains Mono', monospace"
                }}>{t.dir}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── App Principal ─────────────────────────────────────────────────────────────
export default function HardwareConfigurator() {
  const { currentProject, setHardware, nextPhase } = useScadaStore();
  const [hw, setHWLocal] = useState(() => currentProject.hardware ?? initHW());
  const [activeTab, setActiveTab] = useState("device");
  const [showExport, setShowExport] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sincronizar cambios locales al store con debounce
  useEffect(() => {
    const timer = setTimeout(() => setHardware(hw), 400);
    return () => clearTimeout(timer);
  }, [hw]);

  const setHW = (updater) => {
    setHWLocal(updater);
    setSaved(false);
  };

  const handleSaveAndContinue = () => {
    setHardware(hw);
    setSaved(true);
    setTimeout(() => nextPhase(), 300);
  };

  const tags = generateTags(hw);
  const conflicts = getPinConflicts(hw);
  const totalIn  = tags.filter(t => t.dir === "IN" || t.dir === "IO").length;
  const totalOut = tags.filter(t => t.dir === "OUT" || t.dir === "IO").length;

  const tabs = [
    { id: "device",    label: "Dispositivo", icon: "◈" },
    { id: "native",    label: "I/O Nativa",  icon: "⚡" },
    { id: "expansion", label: "Expansión",   icon: "⊞" },
    { id: "tags",      label: `Tags (${tags.length})`, icon: "⋮" },
  ];

  const setDevice = (key, val) => setHW(h => ({ ...h, device: { ...h.device, [key]: val } }));
  const setConn   = (mode, key, val) => setHW(h => ({
    ...h, device: { ...h.device, connection: { ...h.device.connection, [mode]: { ...h.device.connection[mode], [key]: val } } }
  }));

  return (
    <div style={{
      display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
      background: "#060b16", fontFamily: "'Segoe UI', sans-serif", color: "#e2e8f0"
    }}>
      {/* Header */}
      <div style={{
        background: "#0a0f1e", borderBottom: "1px solid #1e293b",
        padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8, background: "#00d4aa22",
            border: "1.5px solid #00d4aa", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 16
          }}>◈</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>WSL SCADA</div>
            <div style={{ fontSize: 10, color: "#475569" }}>Hardware Configurator · F2</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {conflicts.length > 0 && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 6,
              background: "#ef444422", border: "1px solid #ef444444",
              color: "#ef4444", fontFamily: "'JetBrains Mono', monospace"
            }}>⚠ {conflicts.length} conflicto{conflicts.length > 1 ? "s" : ""}</span>
          )}
          <span style={{ fontSize: 11, color: "#00d4aa", fontFamily: "'JetBrains Mono', monospace" }}>
            ↓{totalIn} ↑{totalOut}
          </span>
          <button onClick={() => setShowExport(!showExport)} style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: conflicts.length === 0 && hw.device.id ? "#00d4aa22" : "#1e293b",
            border: `1.5px solid ${conflicts.length === 0 && hw.device.id ? "#00d4aa" : "#334155"}`,
            color: conflicts.length === 0 && hw.device.id ? "#00d4aa" : "#475569",
            cursor: "pointer", fontFamily: "'JetBrains Mono', monospace"
          }}>Exportar .scada</button>
          <button
            onClick={handleSaveAndContinue}
            disabled={conflicts.length > 0 || !hw.device.id}
            style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: saved ? "#22c55e22" : conflicts.length === 0 && hw.device.id ? "#f59e0b" : "#1e293b",
              border: `1.5px solid ${saved ? "#22c55e" : conflicts.length === 0 && hw.device.id ? "#f59e0b" : "#334155"}`,
              color: saved ? "#22c55e" : conflicts.length === 0 && hw.device.id ? "#0f172a" : "#475569",
              cursor: conflicts.length > 0 || !hw.device.id ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace"
            }}
          >{saved ? "✓ Guardado" : "Guardar → F3"}</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar tabs */}
        <div style={{ width: 52, background: "#0a0f1e", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12, gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} title={t.label} style={{
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: activeTab === t.id ? "#00d4aa22" : "transparent",
              color: activeTab === t.id ? "#00d4aa" : "#475569",
              cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center"
            }}>{t.icon}</button>
          ))}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {/* Conflictos */}
          {conflicts.length > 0 && (
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: "#ef444411", border: "1px solid #ef444433" }}>
              {conflicts.map((c, i) => (
                <div key={i} style={{ fontSize: 11, color: "#f87171", fontFamily: "'JetBrains Mono', monospace" }}>⚠ {c.msg}</div>
              ))}
            </div>
          )}

          {/* Tab: Dispositivo */}
          {activeTab === "device" && (
            <Card>
              <SectionHeader title="Dispositivo" sub="Identificación y modo de conexión" color="#00d4aa" icon="◈" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {[
                  { key: "id", label: "ID", placeholder: "equipo-01" },
                  { key: "name", label: "Nombre", placeholder: "Compresor AC" },
                  { key: "description", label: "Descripción", placeholder: "Control de planta" },
                ].map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{f.label}</div>
                    <Input value={hw.device[f.key]} onChange={v => setDevice(f.key, v)} placeholder={f.placeholder} style={{ width: "100%" }} />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>MODO</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["LOCAL", "REMOTE", "AUTO"].map(m => (
                    <button key={m} onClick={() => setDevice("mode", m)} style={{
                      padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                      background: hw.device.mode === m ? "#00d4aa22" : "#1e293b",
                      border: `1.5px solid ${hw.device.mode === m ? "#00d4aa" : "#334155"}`,
                      color: hw.device.mode === m ? "#00d4aa" : "#475569",
                      cursor: "pointer", fontFamily: "'JetBrains Mono', monospace"
                    }}>{m}</button>
                  ))}
                </div>
              </div>

              {(hw.device.mode === "LOCAL" || hw.device.mode === "AUTO") && (
                <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: "#4d9fff11", border: "1px solid #4d9fff22" }}>
                  <div style={{ fontSize: 11, color: "#4d9fff", fontWeight: 700, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>LOCAL (Serial)</div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>PUERTO</div>
                      <Input value={hw.device.connection.local.port} onChange={v => setConn("local", "port", v)} placeholder="COM3" style={{ width: 100 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>BAUD</div>
                      <Select value={hw.device.connection.local.baud} onChange={v => setConn("local", "baud", parseInt(v))}
                        options={[9600, 57600, 115200, 230400].map(b => ({ value: b, label: b }))} />
                    </div>
                  </div>
                </div>
              )}

              {(hw.device.mode === "REMOTE" || hw.device.mode === "AUTO") && (
                <div style={{ padding: 12, borderRadius: 8, background: "#00d4aa11", border: "1px solid #00d4aa22" }}>
                  <div style={{ fontSize: 11, color: "#00d4aa", fontWeight: 700, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>REMOTE (WiFi/HTTP)</div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>IP</div>
                      <Input value={hw.device.connection.remote.ip} onChange={v => setConn("remote", "ip", v)} placeholder="192.168.1.45" style={{ width: 140 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>PUERTO</div>
                      <Input value={hw.device.connection.remote.port} onChange={v => setConn("remote", "port", parseInt(v))} placeholder="80" style={{ width: 70 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>TIMEOUT (ms)</div>
                      <Input value={hw.device.connection.remote.timeout_ms} onChange={v => setConn("remote", "timeout_ms", parseInt(v))} placeholder="3000" style={{ width: 80 }} />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Tab: I/O Nativa */}
          {activeTab === "native" && <NativeIOSection hw={hw} setHW={setHW} />}

          {/* Tab: Expansión */}
          {activeTab === "expansion" && (
            <div>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 16, padding: "8px 12px", background: "#0a0f1e", borderRadius: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                Los ICs 595 y 165 pueden compartir pines CLOCK. ADS1115 y MCP23017 comparten bus I2C (SDA/SCL).
              </div>
              {Object.keys(IC_CONFIGS).map(key => (
                <ExpansionIC key={key} icKey={key} hw={hw} setHW={setHW} />
              ))}
            </div>
          )}

          {/* Tab: Tags */}
          {activeTab === "tags" && (
            <Card>
              <SectionHeader title={`Tags disponibles (${tags.length})`} sub="Generados desde la configuración de hardware" color="#00d4aa" icon="⋮" />
              {tags.length === 0
                ? <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 24 }}>Sin tags — configurá I/O nativa o expansiones</div>
                : <TagTree tags={tags} />
              }
            </Card>
          )}
        </div>

        {/* Panel resumen */}
        <div style={{ width: 200, background: "#0a0f1e", borderLeft: "1px solid #1e293b", padding: 16 }}>
          <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>RESUMEN I/O</div>
          {[
            { label: "Digital IN",  value: tags.filter(t => t.type === "boolean" && t.dir === "IN").length,  color: "#4d9fff" },
            { label: "Digital OUT", value: tags.filter(t => t.type === "boolean" && t.dir === "OUT").length, color: "#00d4aa" },
            { label: "Analog IN",   value: tags.filter(t => t.type === "float").length,                     color: "#f59e0b" },
            { label: "PWM OUT",     value: tags.filter(t => t.type === "integer").length,                   color: "#a78bfa" },
            { label: "Digital IO",  value: tags.filter(t => t.dir === "IO").length,                         color: "#f472b6" },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: r.color, fontFamily: "'JetBrains Mono', monospace" }}>{r.value}</span>
            </div>
          ))}

          <div style={{ borderTop: "1px solid #1e293b", marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>EXPANSIONES</div>
            {Object.entries(hw.expansion).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: v.enabled ? IC_CONFIGS[k].color : "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{IC_CONFIGS[k].label}</span>
                <span style={{ fontSize: 10, color: v.enabled ? IC_CONFIGS[k].color : "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{v.enabled ? `×${v.count}` : "—"}</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: "1px solid #1e293b", marginTop: 12, paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: 2, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>FASES</div>
            {[
              { label: "F1 Schema", done: true },
              { label: "F2 Hardware", done: true },
              { label: "F3 Firmware", done: false },
              { label: "F4 Parser WSL", done: false },
              { label: "F5 Editor", done: false },
              { label: "F6 Runtime", done: false },
            ].map(f => (
              <div key={f.label} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: f.done ? "#00d4aa" : "#334155" }}>{f.done ? "✓" : "○"}</span>
                <span style={{ fontSize: 10, color: f.done ? "#94a3b8" : "#334155" }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal exportar */}
      {showExport && (
        <div style={{
          position: "fixed", inset: 0, background: "#000a",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
        }} onClick={() => setShowExport(false)}>
          <div style={{
            background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
            padding: 24, width: 600, maxHeight: "80vh", overflow: "hidden",
            display: "flex", flexDirection: "column"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "#00d4aa" }}>
                {hw.device.id || "device"}.scada
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => navigator.clipboard?.writeText(buildScadaHeader(hw))} style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: "#00d4aa22", border: "1px solid #00d4aa44", color: "#00d4aa", cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace"
                }}>Copiar</button>
                <button onClick={() => {
                  const blob = new Blob([buildScadaHeader(hw)], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${hw.device.id || "device"}.scada`;
                  a.click();
                }} style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: "#00d4aa", border: "none", color: "#060b16", cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace"
                }}>Descargar</button>
                <button onClick={() => setShowExport(false)} style={{
                  background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18
                }}>×</button>
              </div>
            </div>
            <pre style={{
              flex: 1, overflowY: "auto", fontSize: 10, color: "#94a3b8",
              background: "#060b16", borderRadius: 8, padding: 12, margin: 0,
              fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
              whiteSpace: "pre-wrap", wordBreak: "break-all"
            }}>{buildScadaHeader(hw)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
