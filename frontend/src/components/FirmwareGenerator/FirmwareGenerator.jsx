import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { useScadaStore } from "../../store/scadaStore.js";
import { generateWslInterpreterCpp } from "../../engine/WslInterpreterCpp.js";

// ══════════════════════════════════════════════════════════════════
//  GENERADOR DE FIRMWARE — lógica pura
// ══════════════════════════════════════════════════════════════════
function generateFirmware(hw, script = '') {
  const d   = hw.device;
  const nat = hw.native;
  const exp = hw.expansion;
  const hasWifi   = d.mode === "REMOTE" || d.mode === "AUTO";
  const hasSerial = d.mode === "LOCAL"  || d.mode === "AUTO";
  const has595 = exp.ic595.enabled    && exp.ic595.count    > 0;
  const has165 = exp.ic165.enabled    && exp.ic165.count    > 0;
  const hasADS = exp.ads1115.enabled  && exp.ads1115.count  > 0;
  const hasMCP = exp.mcp23017.enabled && exp.mcp23017.count > 0;
  const total595out = has595 ? exp.ic595.count   * 8 : 0;
  const total165in  = has165 ? exp.ic165.count   * 8 : 0;
  const totalADSch  = hasADS ? exp.ads1115.count * 4 : 0;
  const dp = (name, val) => `#define ${name.padEnd(22)} ${val}`;
  const sec = (t) => `\n// ${"─".repeat(58)}\n// ${t}\n// ${"─".repeat(58)}\n`;

  // INTÉRPRETE WSL (hot-reload en runtime, no transpilación)
  const wslInterpreterCpp = generateWslInterpreterCpp(hw);
  const hasScript = !!script?.trim();

  // INCLUDES
  const inc = [
    '#include <Arduino.h>',
    hasWifi  ? '#include <WiFi.h>'               : null,
    hasWifi  ? '#include <WebServer.h>'           : null,
    '#include <ArduinoJson.h>',
    '#include <LittleFS.h>',
    (hasADS || hasMCP) ? '#include <Wire.h>'     : null,
    hasADS   ? '#include <Adafruit_ADS1X15.h>'   : null,
    hasMCP   ? '#include <Adafruit_MCP23X17.h>'  : null,
  ].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('\n');

  // DEFINES
  const defs = [
    `// Generado por WSL SCADA v1.0`,
    `// Dispositivo : ${d.name || d.id}`,
    `// ID          : ${d.id}`,
    `// Modo        : ${d.mode}`,
    `// Generado    : ${new Date().toISOString()}`,
    '',
    hasWifi ? dp('WIFI_SSID',    '"TU_SSID"')    : null,
    hasWifi ? dp('WIFI_PASSWORD','"TU_PASSWORD"') : null,
    hasWifi ? dp('HTTP_PORT',    d.connection.remote.port || 80) : null,
    hasWifi ? '' : null,
    has595 ? `// 74HC595 — ${exp.ic595.count} IC(s) = ${total595out} salidas` : null,
    has595 ? dp('SR595_COUNT', exp.ic595.count)           : null,
    has595 ? dp('SR595_DATA',  exp.ic595.pins.data  || 23): null,
    has595 ? dp('SR595_CLOCK', exp.ic595.pins.clock || 22): null,
    has595 ? dp('SR595_LATCH', exp.ic595.pins.latch || 21): null,
    has595 ? '' : null,
    has165 ? `// 74HC165 — ${exp.ic165.count} IC(s) = ${total165in} entradas` : null,
    has165 ? dp('SR165_COUNT', exp.ic165.count)           : null,
    has165 ? dp('SR165_DATA',  exp.ic165.pins.data  || 19): null,
    has165 ? dp('SR165_CLOCK', exp.ic165.pins.clock || 22): null,
    has165 ? dp('SR165_LOAD',  exp.ic165.pins.load  || 20): null,
    has165 ? '' : null,
    ...nat.digital_in.map(p  => dp(`PIN_DIN_${p.gpio}`,  p.gpio)),
    ...nat.digital_out.map(p => dp(`PIN_DOUT_${p.gpio}`, p.gpio)),
    ...nat.analog_in.map(p   => dp(`PIN_AIN_${p.gpio}`,  p.gpio)),
    ...nat.pwm_out.map(p     => dp(`PIN_PWM_${p.gpio}`,  p.gpio)),
  ].filter(v => v !== null).join('\n');

  // GLOBALS
  const glb = [
    hasWifi ? 'WebServer server(HTTP_PORT);' : null,
    has595  ? `uint${total595out > 8 ? 32 : 8}_t sr595State = 0;` : null,
    has165  ? `uint${total165in  > 8 ? 32 : 8}_t sr165State = 0;` : null,
    hasADS  ? exp.ads1115.devices.map((_,i)=>`Adafruit_ADS1115 ads${i};`).join('\n') : null,
    hasADS  ? `float adsValues[${totalADSch}] = {0};` : null,
    hasMCP  ? exp.mcp23017.devices.map((_,i)=>`Adafruit_MCP23X17 mcp${i};`).join('\n') : null,
    ...nat.digital_in.map(p  => `bool  din_gpio${p.gpio}  = false;`),
    ...nat.digital_out.map(p => `bool  dout_gpio${p.gpio} = false;`),
    ...nat.analog_in.map(p   => `float ain_adc${p.gpio}   = 0.0f;`),
    ...nat.pwm_out.map(p     => `int   pwm_gpio${p.gpio}  = 0;`),
  ].filter(Boolean).join('\n');

  // FN 595
  const fn595 = has595 ? `
void sr595Write(uint${total595out > 8 ? 32 : 8}_t data) {
  sr595State = data;
  digitalWrite(SR595_LATCH, LOW);
  for (int i = ${total595out - 1}; i >= 0; i--) {
    digitalWrite(SR595_CLOCK, LOW);
    digitalWrite(SR595_DATA, (data >> i) & 1);
    digitalWrite(SR595_CLOCK, HIGH);
  }
  digitalWrite(SR595_LATCH, HIGH);
}
void sr595SetBit(uint8_t bit, bool val) {
  if (val) sr595State |=  (1UL << bit);
  else     sr595State &= ~(1UL << bit);
  sr595Write(sr595State);
}
bool sr595GetBit(uint8_t bit) { return (sr595State >> bit) & 1; }` : '';

  // FN 165
  const fn165 = has165 ? `
uint${total165in > 8 ? 32 : 8}_t sr165Read() {
  uint${total165in > 8 ? 32 : 8}_t data = 0;
  digitalWrite(SR165_LOAD, LOW);
  delayMicroseconds(5);
  digitalWrite(SR165_LOAD, HIGH);
  for (int i = 0; i < ${total165in}; i++) {
    data = (data << 1) | digitalRead(SR165_DATA);
    digitalWrite(SR165_CLOCK, HIGH);
    delayMicroseconds(2);
    digitalWrite(SR165_CLOCK, LOW);
  }
  sr165State = data;
  return data;
}
bool sr165GetBit(uint8_t bit) { return (sr165State >> bit) & 1; }` : '';

  // FN ADS
  const fnADS = hasADS ? `
void adsReadAll() {
  ${exp.ads1115.devices.map((_,i)=>[0,1,2,3].map(ch=>`adsValues[${i*4+ch}] = ads${i}.computeVolts(ads${i}.readADC_SingleEnded(${ch}));`).join('\n  ')).join('\n  ')}
}` : '';

  // JSON TELEMETRY
  const jf = [
    ...nat.digital_in.map(p  => `  doc["${d.id}.din.gpio${p.gpio}"]  = din_gpio${p.gpio};`),
    ...nat.digital_out.map(p => `  doc["${d.id}.dout.gpio${p.gpio}"] = dout_gpio${p.gpio};`),
    ...nat.analog_in.map(p   => `  doc["${d.id}.ain.adc${p.gpio}"]   = ain_adc${p.gpio};`),
    ...nat.pwm_out.map(p     => `  doc["${d.id}.pwm.gpio${p.gpio}"]  = pwm_gpio${p.gpio};`),
    ...(has595 ? Array.from({length:total595out},(_,i)=>`  doc["${d.id}.595.out.${i}"] = sr595GetBit(${i});`) : []),
    ...(has165 ? Array.from({length:total165in}, (_,i)=>`  doc["${d.id}.165.in.${i}"]  = sr165GetBit(${i});`) : []),
    ...(hasADS ? Array.from({length:totalADSch}, (_,i)=>`  doc["${d.id}.ads.${Math.floor(i/4)}.ch${i%4}"] = adsValues[${i}];`) : []),
  ].join('\n');

  const fnTelemetry = `
String buildTelemetryJSON() {
  StaticJsonDocument<1024> doc;
  doc["device_id"] = "${d.id}";
  doc["timestamp"] = millis();
${jf}
  String out;
  serializeJson(doc, out);
  return out;
}`;

  // INTÉRPRETE WSL
  const wslSection = wslInterpreterCpp;

  // LITTLEFS — persistencia de logs y alarmas para modo autónomo
  const fsSection = `
// ── LittleFS: logs y alarmas persistentes ─────────────────────────────────────
#define LOG_FILE     "/wsl_log.jsonl"
#define ALARM_FILE   "/wsl_alarms.jsonl"
#define MAX_LOG_KB   64

void fs_init() {
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] Error montando LittleFS");
    return;
  }
  Serial.println("[FS] LittleFS OK");
}

// Agrega una línea JSONL al archivo (descarta las más viejas si supera MAX_LOG_KB)
void fs_append(const char* path, const String& line) {
  File f = LittleFS.open(path, "a");
  if (!f) return;
  if (f.size() > MAX_LOG_KB * 1024) {
    f.close();
    LittleFS.remove(path); // rotación simple: borra al superar límite
    f = LittleFS.open(path, "w");
  }
  f.println(line);
  f.close();
}

void wsl_append_log(const String& level, const String& msg) {
  StaticJsonDocument<256> doc;
  doc["ts"]  = millis();
  doc["lvl"] = level;
  doc["msg"] = msg;
  String out; serializeJson(doc, out);
  fs_append(LOG_FILE, out);
}

void wsl_append_alarm(const String& level, const String& msg) {
  StaticJsonDocument<256> doc;
  doc["ts"]    = millis();
  doc["level"] = level;
  doc["msg"]   = msg;
  doc["acked"] = false;
  String out; serializeJson(doc, out);
  fs_append(ALARM_FILE, out);
}

// Sirve un archivo JSONL como array JSON
void fs_serve_as_array(const char* path) {
${hasWifi ? `  if (!LittleFS.exists(path)) { server.send(200, "application/json", "[]"); return; }
  File f = LittleFS.open(path, "r");
  String out = "[";
  bool first = true;
  while (f.available()) {
    String line = f.readStringUntil('\\n');
    line.trim();
    if (line.length() == 0) continue;
    if (!first) out += ",";
    out += line;
    first = false;
  }
  out += "]";
  f.close();
  server.send(200, "application/json", out);` : `  // Sin WiFi: logs solo por Serial`}
}`;

  // HTTP HANDLERS
  const httpH = hasWifi ? `
void handleTelemetry() {
  server.send(200, "application/json", buildTelemetryJSON());
}

void handleCommand() {
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "No body"); return; }
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, server.arg("plain"))) { server.send(400, "text/plain", "JSON invalido"); return; }
  const char* tag = doc["tag"];
  JsonVariant val = doc["value"];
  String t(tag);
  ${has595 ? `if (t.startsWith("${d.id}.595.out.")) { sr595SetBit(t.substring(t.lastIndexOf('.')+1).toInt(), val.as<bool>()); }
  else ` : ''}${nat.digital_out.map(p=>`if (t == "${d.id}.dout.gpio${p.gpio}") { dout_gpio${p.gpio} = val.as<bool>(); digitalWrite(${p.gpio}, dout_gpio${p.gpio}); }\n  else `).join('')}{ server.send(404, "text/plain", "Tag no encontrado"); return; }
  server.send(200, "application/json", "{\\"ok\\":true}");
}

void handlePing() {
  StaticJsonDocument<128> doc;
  doc["device_id"] = "${d.id}";
  doc["uptime_ms"] = millis();
  doc["mode"]      = "${d.mode}";
  String out; serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleLogs()   { fs_serve_as_array(LOG_FILE);   }
void handleAlarms() { fs_serve_as_array(ALARM_FILE);  }
void handleClearLogs() {
  LittleFS.remove(LOG_FILE);
  LittleFS.remove(ALARM_FILE);
  server.send(200, "application/json", "{\\"ok\\":true}");
}` : '';

  // SETUP
  const su = [
    hasSerial ? '  Serial.begin(115200);' : null,
    `  Serial.println("WSL SCADA — ${d.name || d.id}");`,
    '',
    ...nat.digital_in.map(p  => `  pinMode(${p.gpio}, INPUT${p.pull==='UP'?'_PULLUP':p.pull==='DOWN'?'_PULLDOWN':''});`),
    ...nat.digital_out.map(p => [`  pinMode(${p.gpio}, OUTPUT);`, `  digitalWrite(${p.gpio}, LOW);`]).flat(),
    ...nat.pwm_out.map((p,i) => [`  ledcSetup(${i}, 1000, 8);`, `  ledcAttachPin(${p.gpio}, ${i});`]).flat(),
    has595 ? ['',' // 74HC595','  pinMode(SR595_DATA,  OUTPUT);','  pinMode(SR595_CLOCK, OUTPUT);','  pinMode(SR595_LATCH, OUTPUT);','  sr595Write(0);'] : [],
    has165 ? ['',' // 74HC165','  pinMode(SR165_DATA,  INPUT);','  pinMode(SR165_CLOCK, OUTPUT);','  pinMode(SR165_LOAD,  OUTPUT);','  digitalWrite(SR165_LOAD, HIGH);'] : [],
    hasADS ? ['', ` // ADS1115`, `  Wire.begin(${exp.ads1115.pins.sda||21}, ${exp.ads1115.pins.scl||22});`, ...exp.ads1115.devices.map((_,i)=>[`  ads${i}.setGain(GAIN_ONE);`,`  ads${i}.begin(${exp.ads1115.devices[i].addr});`]).flat()] : [],
    hasMCP ? ['', ` // MCP23017`, !hasADS?`  Wire.begin(${exp.mcp23017.pins.sda||21}, ${exp.mcp23017.pins.scl||22});`:null, ...exp.mcp23017.devices.map((_,i)=>`  mcp${i}.begin_I2C(${exp.mcp23017.devices[i].addr});`)].filter(Boolean) : [],
    '', '  // LittleFS',
    '  fs_init();',
    hasWifi ? [
      '', '  // WiFi',
      '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
      '  Serial.print("Conectando WiFi");',
      '  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }',
      '  Serial.println("\\nIP: " + WiFi.localIP().toString());',
      '', '  // HTTP endpoints',
      '  server.on("/api/telemetry", HTTP_GET,  handleTelemetry);',
      '  server.on("/api/command",   HTTP_POST, handleCommand);',
      '  server.on("/api/ping",      HTTP_GET,  handlePing);',
      '  server.on("/api/logs",      HTTP_GET,    handleLogs);',
      '  server.on("/api/alarms",    HTTP_GET,    handleAlarms);',
      '  server.on("/api/logs",      HTTP_DELETE, handleClearLogs);',
      '  server.on("/api/script",    HTTP_POST,   handleScriptUpload);',
      '  server.on("/api/script",    HTTP_GET,    handleScriptGet);',
      '  server.begin();',
    ] : [],
    '', '  // Script WSL — cargar desde LittleFS y ejecutar ON STARTUP',
    '  wsl_load();',
  ].flat().filter(v => v !== null).join('\n');

  // LOOP
  const lp = [
    hasWifi  ? '  server.handleClient();' : null,
    ...nat.digital_in.map(p => `  din_gpio${p.gpio} = digitalRead(${p.gpio});`),
    ...nat.analog_in.map(p  => `  ain_adc${p.gpio}  = analogRead(${p.gpio}) * (3.3f / 4095.0f);`),
    has165  ? '  sr165Read();'  : null,
    hasADS  ? '  adsReadAll();' : null,
    '', '  // Script WSL — tick del intérprete',
    '  wsl_tick();',
    !hasWifi && hasSerial ? [
      '',
      '  static unsigned long lastSer = 0;',
      '  if (millis() - lastSer > 1000) { Serial.println(buildTelemetryJSON()); lastSer = millis(); }',
    ] : [],
    '  delay(10);',
  ].flat().filter(v => v !== null).join('\n');

  return [
    inc,
    sec('DEFINES'), defs,
    sec('VARIABLES GLOBALES'), glb,
    sec('74HC595'), fn595,
    sec('74HC165'), fn165,
    sec('ADS1115'),  fnADS,
    sec('TELEMETRÍA JSON'), fnTelemetry,
    sec('LITTLEFS — LOGS Y ALARMAS'), fsSection,
    sec('HTTP HANDLERS'), httpH,
    sec('SCRIPT WSL — LÓGICA AUTÓNOMA'), wslSection,
    sec('SETUP'),
    'void setup() {', su, '}',
    sec('LOOP'),
    'void loop() {', lp, '}',
  ].filter(s => s.trim() !== '').join('\n');
}

// ══════════════════════════════════════════════════════════════════
//  DEMO HARDWARE
// ══════════════════════════════════════════════════════════════════
const DEMO_HW = {
  device: {
    id: "equipo-01", name: "Compresor AC Planta", description: "Demo F3",
    mode: "REMOTE",
    connection: { local: { port: "COM3", baud: 115200 }, remote: { ip: "192.168.1.45", port: 80, timeout_ms: 3000 } }
  },
  native: {
    digital_in:  [{ gpio: 4, label: "Pulsador", pull: "UP" }, { gpio: 5, label: "Fin carrera", pull: "UP" }],
    digital_out: [{ gpio: 16, label: "LED estado", default: 0 }],
    analog_in:   [{ gpio: 32, label: "Sensor NTC", resolution: 12 }],
    pwm_out:     []
  },
  expansion: {
    ic595:    { enabled: true,  count: 2, pins: { data: 23, clock: 22, latch: 21 }, outputs: Array.from({length:16},(_,i)=>({index:i,label:`Relé ${i}`,default:0})) },
    ic165:    { enabled: true,  count: 1, pins: { data: 19, clock: 22, load: 20  }, inputs:  Array.from({length:8}, (_,i)=>({index:i,label:`IN ${i}`})) },
    ads1115:  { enabled: true,  count: 2, pins: { sda: 21, scl: 22 }, devices: [
      { index: 0, addr: "0x48", channels: [{ch:0,label:"Presión",gain:1,unit:"bar",scale_min:0,scale_max:10},{ch:1,label:"Corriente",gain:2,unit:"A",scale_min:0,scale_max:30},{ch:2,label:"Temp",gain:1,unit:"°C",scale_min:-20,scale_max:80},{ch:3,label:"Voltaje",gain:1,unit:"V",scale_min:0,scale_max:5}] },
      { index: 1, addr: "0x49", channels: [0,1,2,3].map(ch=>({ch,label:`ADS1 CH${ch}`,gain:1,unit:"",scale_min:0,scale_max:100})) }
    ]},
    mcp23017: { enabled: false, count: 0, pins: { sda: 21, scl: 22 }, devices: [] }
  }
};

// ══════════════════════════════════════════════════════════════════
//  SYNTAX HIGHLIGHT
// ══════════════════════════════════════════════════════════════════
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colorize(line) {
  const esc = escapeHtml(line);
  if (line.trim().startsWith('//'))
    return `<span style="color:#4a6070;font-style:italic">${esc}</span>`;
  if (line.trim().startsWith('#'))
    return `<span style="color:#68d391">${esc}</span>`;
  return esc
    .replace(/(&quot;.*?&quot;)/g, '<span style="color:#f6ad55">$1</span>')
    .replace(/\b(void|bool|int|float|uint8_t|uint16_t|uint32_t|String|const|char|if|else|while|for|return|true|false|LOW|HIGH|INPUT|OUTPUT|INPUT_PULLUP|INPUT_PULLDOWN|NULL|static|unsigned|long)\b/g,'<span style="color:#63b3ed">$1</span>')
    .replace(/\b(\d+)\b/g,'<span style="color:#fc8181">$1</span>')
    .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g,'<span style="color:#b794f4">$1</span>');
}

function CodeView({ code }) {
  return (
    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, lineHeight:1.7 }}>
      {code.split('\n').map((line, i) => (
        <div key={i} style={{ display:"flex", minHeight:20 }}>
          <span style={{ color:"#2d3748", userSelect:"none", minWidth:44, paddingRight:16, textAlign:"right", flexShrink:0, fontSize:11 }}>{i+1}</span>
          <span dangerouslySetInnerHTML={{ __html: colorize(line) }} style={{ whiteSpace:"pre" }} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  UI COMPONENTS
// ══════════════════════════════════════════════════════════════════
function Badge({ label, value, color }) {
  return (
    <div style={{ background:"#0d1117", border:`1px solid ${color}33`, borderRadius:8, padding:"10px 14px", minWidth:80 }}>
      <div style={{ fontSize:20, fontWeight:800, color, fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
      <div style={{ fontSize:10, color:"#4a5568", marginTop:2 }}>{label}</div>
    </div>
  );
}

function Check({ label, active, color="#00d4aa" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
      <span style={{ width:18, height:18, borderRadius:4, background:active?color+"22":"#1a2035", border:`1.5px solid ${active?color:"#2d3748"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:active?color:"#2d3748", flexShrink:0 }}>
        {active?"✓":"○"}
      </span>
      <span style={{ fontSize:12, color:active?"#a0aec0":"#4a5568" }}>{label}</span>
    </div>
  );
}

function EndpointCard({ method, path, desc }) {
  const color = method === "GET" ? "#4d9fff" : "#00d4aa";
  return (
    <div style={{ marginBottom:8, padding:"8px 10px", borderRadius:6, background:"#080d14", border:"1px solid #1a2035" }}>
      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:2 }}>
        <span style={{ fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3, background:color+"22", color, fontFamily:"'JetBrains Mono',monospace" }}>{method}</span>
        <span style={{ fontSize:10, color:"#e2e8f0", fontFamily:"'JetBrains Mono',monospace" }}>{path}</span>
      </div>
      <div style={{ fontSize:10, color:"#4a5568" }}>{desc}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  APP
// ══════════════════════════════════════════════════════════════════
export default function FirmwareGenerator() {
  const { currentProject, setFirmware, nextPhase } = useScadaStore();
  const hw = currentProject.hardware ?? DEMO_HW;
  const [code, setCode]           = useState(currentProject.firmware ?? "");
  const [generated, setGenerated] = useState(!!currentProject.firmware);
  const [section, setSection]     = useState("all");
  const [copied, setCopied]       = useState(false);

  // Compilación
  const [compiling, setCompiling]    = useState(false);
  const [compileStatus, setCompileStatus] = useState("idle"); // idle|compiling|ok|error
  const [compileLogs, setCompileLogs]    = useState("");
  const [compiledBinary, setCompiledBinary] = useState(null); // Almacena el .bin en base64
  const logsEndRef = useRef(null);

  // Auto-scroll del panel de logs cuando llegan nuevas líneas
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [compileLogs]);

  const exp    = hw.expansion;
  const has595 = exp.ic595.enabled    && exp.ic595.count    > 0;
  const has165 = exp.ic165.enabled    && exp.ic165.count    > 0;
  const hasADS = exp.ads1115.enabled  && exp.ads1115.count  > 0;
  const hasMCP = exp.mcp23017.enabled && exp.mcp23017.count > 0;
  const totalIn  = hw.native.digital_in.length + (has165?exp.ic165.count*8:0) + (hasADS?exp.ads1115.count*4:0) + hw.native.analog_in.length;
  const totalOut = hw.native.digital_out.length + (has595?exp.ic595.count*8:0) + hw.native.pwm_out.length;

  const generate = () => {
    const generated = generateFirmware(hw, currentProject.script || '');
    setCode(generated);
    setGenerated(true);
    setSection("all");
    setFirmware(generated);
  };

  const handleContinue = () => {
    setFirmware(code); // Guardar el código editado (o generado)
    setTimeout(() => nextPhase(), 150);
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code], { type:"text/plain" }));
    a.download = `${hw.device.id}.ino`;
    a.click();
  };

  const copy = () => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  const compile = async () => {
    setCompiling(true);
    setCompileStatus("compiling");
    setCompileLogs("");
    setCompiledBinary(null);

    const appendLog = (line) =>
      setCompileLogs((prev) => (prev ? prev + "\n" + line : line));

    try {
      const response = await fetch(`/api/firmware/compile-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject.id || "default",
          projectName: currentProject.name || "sketch",
          code: code,
          boardId: "esp32:esp32:esp32",
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE lines: "data: ...\n\n"
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLine = part.startsWith("data: ") ? part.slice(6) : part;
          if (!dataLine.trim()) continue;

          if (dataLine.startsWith("RESULT:")) {
            try { finalResult = JSON.parse(dataLine.slice(7)); } catch { /* ignore */ }
          } else if (dataLine.startsWith("LOG: ") || dataLine.startsWith("ERROR: ")) {
            appendLog(dataLine);
          } else {
            appendLog(dataLine);
          }
        }
      }

      if (finalResult?.success && finalResult?.binary) {
        setCompileStatus("ok");
        setCompiledBinary(finalResult.binary);
        appendLog("✓ Compilación exitosa");
      } else {
        setCompileStatus("error");
        if (finalResult?.error) appendLog(`\n✕ ${finalResult.error}`);
      }
    } catch (err) {
      setCompileStatus("error");
      appendLog(`Error de conexión: ${err.message}\n(Backend debe estar en puerto 5000)`);
    } finally {
      setCompiling(false);
    }
  };

  const downloadBinary = () => {
    if (!compiledBinary) return;
    const binaryData = Uint8Array.from(atob(compiledBinary), c => c.charCodeAt(0));
    const blob = new Blob([binaryData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${hw.device.id}-firmware.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleCode = () => {
    if (!code || section === "all") return code;
    const lines = code.split('\n');
    if (section === "setup") { const s=code.indexOf('void setup()'), e=code.indexOf('void loop()'); return s>=0?code.slice(s,e).trim():code; }
    if (section === "loop")  { const s=code.indexOf('void loop()');  return s>=0?code.slice(s).trim():code; }
    if (section === "inc")   return lines.filter(l=>l.startsWith('#include')).join('\n');
    if (section === "def")   return lines.filter(l=>l.startsWith('#define')||l.startsWith('//')).join('\n');
    return code;
  };

  const lineCount = code ? code.split('\n').length : 0;
  const SECTIONS = [
    {id:"all",  label:"Completo"},
    {id:"inc",  label:"#include"},
    {id:"def",  label:"#define"},
    {id:"setup",label:"setup()"},
    {id:"loop", label:"loop()"},
  ];

  return (
    <div style={{ flex:1, minHeight:0, background:"#080d14", fontFamily:"'Segoe UI',sans-serif", color:"#e2e8f0", display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ background:"#0d1117", borderBottom:"1px solid #1a2035", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ width:32, height:32, borderRadius:8, background:"#f59e0b22", border:"1.5px solid #f59e0b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚙</span>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:"#e2e8f0", fontFamily:"'JetBrains Mono',monospace", letterSpacing:1 }}>WSL SCADA</div>
            <div style={{ fontSize:10, color:"#4a5568" }}>Firmware Generator · F3</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {generated && <>
            <span style={{ fontSize:11, color:"#4a5568", fontFamily:"'JetBrains Mono',monospace" }}>{lineCount} líneas · {(code.length/1024).toFixed(1)} KB</span>
            <button onClick={copy} style={{ padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:700, background:copied?"#00d4aa22":"#1a2035", border:`1.5px solid ${copied?"#00d4aa":"#2d3748"}`, color:copied?"#00d4aa":"#718096", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>{copied?"✓ Copiado":"Copiar"}</button>
            <button onClick={download} style={{ padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:700, background:"#f59e0b22", border:"1.5px solid #f59e0b", color:"#f59e0b", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>↓ {hw.device.id}.ino</button>
            <button onClick={compile} disabled={compiling} style={{ padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:700, background:compiling?"#475569":"#3b82f6", border:"1.5px solid #3b82f6", color:"#fff", cursor:compiling?"not-allowed":"pointer", fontFamily:"'JetBrains Mono',monospace", opacity:compiling?0.5:1 }}>🔨 {compiling?"Compilando...":"Compilar"}</button>
            {compiledBinary && <button onClick={downloadBinary} style={{ padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:700, background:"#22c55e22", border:"1.5px solid #22c55e", color:"#22c55e", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>⬇ firmware.bin</button>}
            <button onClick={handleContinue} style={{ padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:700, background:"#22c55e", border:"none", color:"#080d14", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>Guardar → F4</button>
          </>}
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* Panel izquierdo */}
        <div style={{ width:260, background:"#0d1117", borderRight:"1px solid #1a2035", overflowY:"auto", padding:20, flexShrink:0 }}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"#4a5568", letterSpacing:2, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>DISPOSITIVO</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#e2e8f0", fontFamily:"'JetBrains Mono',monospace" }}>{hw.device.name}</div>
            <div style={{ fontSize:11, color:"#4a5568", fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>{hw.device.id}</div>
            <div style={{ display:"flex", gap:6 }}>
              {["LOCAL","REMOTE","AUTO"].map(m=>(
                <span key={m} style={{ fontSize:9, padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, background:hw.device.mode===m?"#f59e0b22":"transparent", border:`1px solid ${hw.device.mode===m?"#f59e0b":"#1a2035"}`, color:hw.device.mode===m?"#f59e0b":"#2d3748" }}>{m}</span>
              ))}
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
            <Badge label="Entradas" value={totalIn}  color="#4d9fff" />
            <Badge label="Salidas"  value={totalOut} color="#00d4aa" />
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"#4a5568", letterSpacing:2, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>MÓDULOS</div>
            <Check label={`WiFi + HTTP Server`}                       active={hw.device.mode!=="LOCAL"} color="#4d9fff" />
            <Check label={`Serial (${hw.device.connection.local.baud} baud)`} active={hw.device.mode!=="REMOTE"} color="#a78bfa" />
            <Check label={`74HC595 ×${exp.ic595.count} = ${exp.ic595.count*8} out`} active={has595} color="#00d4aa" />
            <Check label={`74HC165 ×${exp.ic165.count} = ${exp.ic165.count*8} in`}  active={has165} color="#00d4aa" />
            <Check label={`ADS1115 ×${exp.ads1115.count} = ${exp.ads1115.count*4} ch`} active={hasADS} color="#f59e0b" />
            <Check label={`MCP23017 ×${exp.mcp23017.count} = ${exp.mcp23017.count*16} io`} active={hasMCP} color="#a78bfa" />
          </div>

          {hw.device.mode !== "LOCAL" && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, color:"#4a5568", letterSpacing:2, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>HTTP ENDPOINTS</div>
              <EndpointCard method="GET"  path="/api/telemetry" desc="Lee todos los tags" />
              <EndpointCard method="POST" path="/api/command"   desc="Escribe un tag" />
              <EndpointCard method="GET"  path="/api/ping"      desc="Estado del dispositivo" />
            </div>
          )}

          <div>
            <div style={{ fontSize:10, color:"#4a5568", letterSpacing:2, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>LIBRERÍAS ARDUINO</div>
            {[
              "ArduinoJson",
              hw.device.mode!=="LOCAL" ? "WiFi" : null,
              hw.device.mode!=="LOCAL" ? "WebServer" : null,
              hasADS ? "Adafruit ADS1X15" : null,
              hasMCP ? "Adafruit MCP23X17": null,
            ].filter(Boolean).map(lib=>(
              <div key={lib} style={{ fontSize:11, color:"#68d391", fontFamily:"'JetBrains Mono',monospace", marginBottom:4, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ color:"#2d3748" }}>▸</span>{lib}
              </div>
            ))}
          </div>

          <div style={{ marginTop:20, borderTop:"1px solid #1a2035", paddingTop:16 }}>
            <div style={{ fontSize:10, color:"#4a5568", letterSpacing:2, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>FASES</div>
            {[["F1","Schema .scada",true],["F2","Config Hardware",true],["F3","Firmware ESP32",true],["F4","Parser WSL",false],["F5","Editor Canvas",false],["F6","Runtime Engine",false]].map(([f,l,d])=>(
              <div key={f} style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4 }}>
                <span style={{ fontSize:10, color:d?"#00d4aa":"#2d3748" }}>{d?"✓":"○"}</span>
                <span style={{ fontSize:10, color:d?"#94a3b8":"#2d3748" }}>{f} {l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel código */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {generated && (
            <div style={{ background:"#0d1117", borderBottom:"1px solid #1a2035", padding:"0 16px", display:"flex", alignItems:"center", gap:4, height:40, flexShrink:0 }}>
              {SECTIONS.map(s=>(
                <button key={s.id} onClick={()=>setSection(s.id)} style={{ padding:"4px 12px", borderRadius:4, fontSize:11, fontWeight:600, background:section===s.id?"#f59e0b22":"transparent", border:`1px solid ${section===s.id?"#f59e0b44":"transparent"}`, color:section===s.id?"#f59e0b":"#4a5568", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>{s.label}</button>
              ))}
            </div>
          )}

          {!generated ? (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:24 }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:52, marginBottom:12 }}>⚙</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#e2e8f0", marginBottom:8, fontFamily:"'JetBrains Mono',monospace" }}>Firmware listo para generar</div>
                <div style={{ fontSize:12, color:"#4a5568", marginBottom:24 }}>Hardware configurado · {totalIn} entradas · {totalOut} salidas</div>
                <button onClick={generate} style={{ padding:"12px 36px", borderRadius:8, fontSize:14, fontWeight:700, background:"#f59e0b", border:"none", color:"#080d14", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", letterSpacing:1 }}>
                  GENERAR FIRMWARE
                </button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                <Badge label="Módulos"  value={[has595,has165,hasADS,hasMCP].filter(Boolean).length} color="#f59e0b" />
                <Badge label="Entradas" value={totalIn}  color="#4d9fff" />
                <Badge label="Salidas"  value={totalOut} color="#00d4aa" />
              </div>
            </div>
          ) : (
            <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              {/* Editor Monaco */}
              <div style={{ flex: compileStatus !== "idle" ? 0.6 : 1, overflow:"hidden", borderBottom: compileStatus !== "idle" ? "1px solid #1a2035" : "none" }}>
                <Editor
                  height="100%"
                  defaultLanguage="cpp"
                  value={visibleCode()}
                  onChange={(val) => { if (section === "all") setCode(val || ""); }}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "on",
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    fontFamily: "'Fira Code', 'Monaco', monospace",
                  }}
                />
              </div>

              {/* Panel logs compilación */}
              {compileStatus !== "idle" && (
                <div style={{
                  flex: 0.4,
                  display:"flex",
                  flexDirection:"column",
                  background:"#0d1117",
                  borderTop:"1px solid #1a2035",
                  overflow:"hidden"
                }}>
                  <div style={{
                    padding:"8px 16px",
                    borderBottom:"1px solid #1a2035",
                    display:"flex",
                    alignItems:"center",
                    gap:8,
                    flexShrink: 0
                  }}>
                    <span style={{
                      width:8,
                      height:8,
                      borderRadius:"50%",
                      background: compileStatus === "ok" ? "#22c55e" : compileStatus === "error" ? "#ef4444" : "#f59e0b",
                      display:"inline-block"
                    }} />
                    <span style={{ fontSize:11, color:"#94a3b8", fontWeight:600, fontFamily:"'JetBrains Mono',monospace" }}>
                      {compileStatus === "compiling" ? "Compilando..." : compileStatus === "ok" ? "✓ Compilación exitosa" : "✕ Error de compilación"}
                    </span>
                  </div>
                  <div style={{
                    flex:1,
                    overflow:"auto",
                    padding:"12px 16px",
                    fontSize:11,
                    fontFamily:"'Fira Code', 'Monaco', monospace",
                    color:"#94a3b8",
                    whiteSpace:"pre-wrap",
                    wordBreak:"break-word",
                    lineHeight:1.6,
                  }}>
                    {compileLogs}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}
            </div>
          )}

          {generated && (
            <div style={{ background:"#0d1117", borderTop:"1px solid #1a2035", padding:"8px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ fontSize:11, color:"#4a5568", fontFamily:"'JetBrains Mono',monospace" }}>{hw.device.id}.ino · {lineCount} líneas · {(code.length/1024).toFixed(1)} KB</span>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={generate} style={{ padding:"4px 12px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid #2d3748", color:"#718096", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>↺ Regenerar</button>
                <button onClick={download} style={{ padding:"4px 14px", borderRadius:6, fontSize:11, fontWeight:700, background:"#f59e0b", border:"none", color:"#080d14", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>↓ Descargar .ino</button>
                <button onClick={compile} disabled={compiling} style={{ padding:"4px 14px", borderRadius:6, fontSize:11, fontWeight:700, background:compiling?"#475569":"#3b82f6", border:"none", color:"#fff", cursor:compiling?"not-allowed":"pointer", fontFamily:"'JetBrains Mono',monospace", opacity:compiling?0.5:1 }}>🔨 Compilar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
