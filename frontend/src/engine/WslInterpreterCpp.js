/**
 * WslInterpreterCpp.js
 * Genera el código C++ del intérprete WSL que se embebe en el firmware ESP32.
 *
 * El intérprete recibe el AST del script como JSON (producido por WslParser.js)
 * y lo evalúa en runtime sobre el ESP32, sin necesidad de recompilar.
 *
 * Uso:
 *   import { generateWslInterpreterCpp } from './WslInterpreterCpp.js';
 *   const headerCode = generateWslInterpreterCpp(hardware);
 */

export function generateWslInterpreterCpp(hw) {
  const id = hw?.device?.id || 'device';

  return `
// ══════════════════════════════════════════════════════════════════════════════
// WSL INTERPRETER — evaluador de AST JSON en runtime
// El script NO está compilado en el binario: se carga desde LittleFS en /script.wsl.json
// Para actualizar el script: POST /api/script  { "ast": <JSON del AST> }
// ══════════════════════════════════════════════════════════════════════════════

#define WSL_SCRIPT_FILE  "/script.wsl.json"
#define WSL_MAX_VARS     32
#define WSL_MAX_TIMERS   8
#define WSL_MAX_CHANGES  8
#define WSL_MAX_WHILE    10000

// ── Variables de script (ámbito global) ──────────────────────────────────────
struct WslVar { char name[32]; float value; };
WslVar  _wslVars[WSL_MAX_VARS];
uint8_t _wslVarCount = 0;

float wsl_get_var(const char* name) {
  for (uint8_t i = 0; i < _wslVarCount; i++)
    if (strcmp(_wslVars[i].name, name) == 0) return _wslVars[i].value;
  return 0;
}
void wsl_set_var(const char* name, float val) {
  for (uint8_t i = 0; i < _wslVarCount; i++) {
    if (strcmp(_wslVars[i].name, name) == 0) { _wslVars[i].value = val; return; }
  }
  if (_wslVarCount < WSL_MAX_VARS) {
    strncpy(_wslVars[_wslVarCount].name, name, 31);
    _wslVars[_wslVarCount].value = val;
    _wslVarCount++;
  }
}

// ── Timers para ON INTERVAL ───────────────────────────────────────────────────
// Guardamos el índice del evento dentro del array "events" del AST global.
// JsonArray/JsonObject son vistas ligeras (ArduinoJson v7) — no se pueden guardar
// en structs. En su lugar guardamos el índice y lo resolvemos en wsl_tick().
struct WslTimer {
  unsigned long intervalMs;
  unsigned long lastMs;
  uint8_t       eventIndex;   // índice en (*_wslAst)["events"]
  bool          active;
};
// Documento global del AST; las vistas JsonArray/JsonObject son válidas mientras vive.
JsonDocument* _wslAst = nullptr;

WslTimer _wslTimers[WSL_MAX_TIMERS];
uint8_t  _wslTimerCount = 0;

struct WslChangeWatch {
  char    tag[64];
  float   prevValue;
  uint8_t eventIndex;         // índice en (*_wslAst)["events"]
  bool    active;
};
WslChangeWatch _wslChanges[WSL_MAX_CHANGES];
uint8_t        _wslChangeCount = 0;

// ── Resolución de tags a variables C++ ───────────────────────────────────────
float wsl_read_tag(const char* tag) {
  String t(tag);
${_genTagReads(hw)}
  return wsl_get_var(tag); // variable de script
}

bool wsl_write_tag(const char* tag, float val) {
  String t(tag);
${_genTagWrites(hw)}
  wsl_set_var(tag, val);
  return true;
}

// ── Evaluador de expresiones ──────────────────────────────────────────────────
float wsl_eval(JsonObjectConst node);

float wsl_eval(JsonObjectConst node) {
  if (node.isNull()) return 0;
  const char* type = node["type"];
  if (!type) return 0;

  if (strcmp(type, "NumberLiteral")  == 0) return node["value"].as<float>();
  if (strcmp(type, "BooleanLiteral") == 0) return node["value"].as<bool>() ? 1.0f : 0.0f;
  if (strcmp(type, "StringLiteral")  == 0) return 0; // strings no numéricos = 0

  if (strcmp(type, "Identifier") == 0)
    return wsl_get_var(node["name"].as<const char*>());

  if (strcmp(type, "ReadCall") == 0)
    return wsl_read_tag(node["tag"].as<const char*>());

  if (strcmp(type, "NowCall")    == 0) return (float)millis();
  if (strcmp(type, "ModeCall")   == 0) return 0;
  if (strcmp(type, "DeviceCall") == 0) return 0;

  if (strcmp(type, "UnaryExpression") == 0) {
    float operand = wsl_eval(node["operand"].as<JsonObjectConst>());
    const char* op = node["operator"];
    if (strcmp(op, "NOT") == 0 || strcmp(op, "!") == 0) return operand == 0 ? 1 : 0;
    if (strcmp(op, "-")   == 0) return -operand;
    return operand;
  }

  if (strcmp(type, "BinaryExpression") == 0) {
    const char* op = node["operator"];
    float l = wsl_eval(node["left"].as<JsonObjectConst>());
    // Short-circuit AND/OR
    if (strcmp(op, "AND") == 0 || strcmp(op, "&&") == 0)
      return (l != 0 && wsl_eval(node["right"].as<JsonObjectConst>()) != 0) ? 1 : 0;
    if (strcmp(op, "OR")  == 0 || strcmp(op, "||") == 0)
      return (l != 0 || wsl_eval(node["right"].as<JsonObjectConst>()) != 0) ? 1 : 0;
    float r = wsl_eval(node["right"].as<JsonObjectConst>());
    if (strcmp(op, "+")  == 0) return l + r;
    if (strcmp(op, "-")  == 0) return l - r;
    if (strcmp(op, "*")  == 0) return l * r;
    if (strcmp(op, "/")  == 0) return r != 0 ? l / r : 0;
    if (strcmp(op, "==") == 0) return l == r ? 1 : 0;
    if (strcmp(op, "!=") == 0) return l != r ? 1 : 0;
    if (strcmp(op, "<")  == 0) return l <  r ? 1 : 0;
    if (strcmp(op, ">")  == 0) return l >  r ? 1 : 0;
    if (strcmp(op, "<=") == 0) return l <= r ? 1 : 0;
    if (strcmp(op, ">=") == 0) return l >= r ? 1 : 0;
    return 0;
  }

  return 0;
}

// ── Ejecutor de sentencias ────────────────────────────────────────────────────
void wsl_exec(JsonArrayConst stmts);

void wsl_exec_stmt(JsonObjectConst node) {
  if (node.isNull()) return;
  const char* type = node["type"];
  if (!type) return;

  if (strcmp(type, "SetStatement") == 0) {
    float val = wsl_eval(node["value"].as<JsonObjectConst>());
    wsl_write_tag(node["tag"].as<const char*>(), val);
    return;
  }

  if (strcmp(type, "AssignStatement") == 0) {
    float val = wsl_eval(node["value"].as<JsonObjectConst>());
    wsl_set_var(node["name"].as<const char*>(), val);
    return;
  }

  if (strcmp(type, "LogStatement") == 0) {
    float val = wsl_eval(node["message"].as<JsonObjectConst>());
    // Si el nodo message es un StringLiteral, usamos el string directamente
    String msg;
    JsonObjectConst msgNode = node["message"].as<JsonObjectConst>();
    if (!msgNode.isNull() && strcmp(msgNode["type"], "StringLiteral") == 0)
      msg = msgNode["value"].as<const char*>();
    else
      msg = String(val);
    Serial.println("[LOG] " + msg);
    wsl_append_log("LOG", msg);
    return;
  }

  if (strcmp(type, "AlarmStatement") == 0) {
    String msg   = node["message"].as<const char*>();
    String level = node["level"].as<const char*>();
    Serial.println("[ALARM:" + level + "] " + msg);
    wsl_append_log(level, msg);
    return;
  }

  if (strcmp(type, "NotifyStatement") == 0) {
    JsonObjectConst msgNode = node["message"].as<JsonObjectConst>();
    String msg;
    if (!msgNode.isNull() && strcmp(msgNode["type"], "StringLiteral") == 0)
      msg = msgNode["value"].as<const char*>();
    else
      msg = String(wsl_eval(msgNode));
    Serial.println("[NOTIFY] " + msg);
    return;
  }

  if (strcmp(type, "WaitStatement") == 0) {
    float ms = wsl_eval(node["duration"].as<JsonObjectConst>());
    delay((unsigned long)ms);
    return;
  }

  if (strcmp(type, "IfStatement") == 0) {
    float cond = wsl_eval(node["condition"].as<JsonObjectConst>());
    if (cond != 0)
      wsl_exec(node["consequent"].as<JsonArrayConst>());
    else
      wsl_exec(node["alternate"].as<JsonArrayConst>());
    return;
  }

  if (strcmp(type, "WhileStatement") == 0) {
    int guard = WSL_MAX_WHILE;
    while (guard-- > 0 && wsl_eval(node["condition"].as<JsonObjectConst>()) != 0)
      wsl_exec(node["body"].as<JsonArrayConst>());
    return;
  }

  if (strcmp(type, "ForStatement") == 0) {
    const char* varName = node["variable"].as<const char*>();
    float from = wsl_eval(node["from"].as<JsonObjectConst>());
    float to   = wsl_eval(node["to"].as<JsonObjectConst>());
    for (float i = from; i <= to; i++) {
      wsl_set_var(varName, i);
      wsl_exec(node["body"].as<JsonArrayConst>());
    }
    return;
  }
  // CALL ignorado en modo autónomo (requiere HTTP saliente)
}

void wsl_exec(JsonArrayConst stmts) {
  if (stmts.isNull()) return;
  for (JsonObjectConst stmt : stmts)
    wsl_exec_stmt(stmt);
}

// ── Carga del script desde LittleFS ──────────────────────────────────────────
bool wsl_load() {
  _wslTimerCount  = 0;
  _wslChangeCount = 0;
  _wslVarCount    = 0;

  if (_wslAst) { delete _wslAst; _wslAst = nullptr; }

  if (!LittleFS.exists(WSL_SCRIPT_FILE)) {
    Serial.println("[WSL] Sin script en LittleFS");
    return false;
  }

  File f = LittleFS.open(WSL_SCRIPT_FILE, "r");
  size_t size = f.size();

  // El AST puede ser grande; reservamos dinámicamente
  _wslAst = new JsonDocument();
  DeserializationError err = deserializeJson(*_wslAst, f);
  f.close();

  if (err) {
    Serial.println("[WSL] Error parseando AST: " + String(err.c_str()));
    delete _wslAst; _wslAst = nullptr;
    return false;
  }

  // Registrar eventos — guardamos el índice del evento, no la vista JsonArray
  JsonArrayConst events = (*_wslAst)["events"].as<JsonArrayConst>();
  uint8_t evIdx = 0;
  for (JsonObjectConst ev : events) {
    JsonObjectConst event = ev["event"].as<JsonObjectConst>();
    const char* kind = event["kind"];

    if (strcmp(kind, "STARTUP") == 0) {
      wsl_exec(ev["body"].as<JsonArrayConst>());

    } else if (strcmp(kind, "INTERVAL") == 0 && _wslTimerCount < WSL_MAX_TIMERS) {
      float val  = event["value"].as<float>();
      const char* unit = event["unit"];
      unsigned long ms = (unsigned long)val * 1000;
      if (unit && strcmp(unit, "m") == 0) ms *= 60;
      if (unit && strcmp(unit, "h") == 0) ms *= 3600;
      _wslTimers[_wslTimerCount] = { ms, 0, evIdx, true };
      _wslTimerCount++;

    } else if (strcmp(kind, "CHANGE") == 0 && _wslChangeCount < WSL_MAX_CHANGES) {
      const char* tag = event["tag"].as<const char*>();
      strncpy(_wslChanges[_wslChangeCount].tag, tag, 63);
      _wslChanges[_wslChangeCount].prevValue = wsl_read_tag(tag);
      _wslChanges[_wslChangeCount].eventIndex = evIdx;
      _wslChanges[_wslChangeCount].active    = true;
      _wslChangeCount++;
    }
    evIdx++;
  }

  Serial.printf("[WSL] Script cargado: %d timers, %d watchers\\n", _wslTimerCount, _wslChangeCount);
  return true;
}

// ── Tick del intérprete (llamar desde loop()) ────────────────────────────────
void wsl_tick() {
  if (!_wslAst) return;
  unsigned long now = millis();
  JsonArrayConst events = (*_wslAst)["events"].as<JsonArrayConst>();

  // ON INTERVAL
  for (uint8_t i = 0; i < _wslTimerCount; i++) {
    if (!_wslTimers[i].active) continue;
    if (now - _wslTimers[i].lastMs >= _wslTimers[i].intervalMs) {
      _wslTimers[i].lastMs = now;
      JsonArrayConst body = events[_wslTimers[i].eventIndex]["body"].as<JsonArrayConst>();
      wsl_exec(body);
    }
  }

  // ON CHANGE
  for (uint8_t i = 0; i < _wslChangeCount; i++) {
    if (!_wslChanges[i].active) continue;
    float cur = wsl_read_tag(_wslChanges[i].tag);
    if (cur != _wslChanges[i].prevValue) {
      _wslChanges[i].prevValue = cur;
      JsonArrayConst body = events[_wslChanges[i].eventIndex]["body"].as<JsonArrayConst>();
      wsl_exec(body);
    }
  }
}

// ── Hot-reload: guarda nuevo AST y recarga sin reiniciar ─────────────────────
${hw?.device?.mode !== 'LOCAL' ? `
void handleScriptUpload() {
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "Sin body"); return; }

  // Validar que es JSON válido antes de guardar
  JsonDocument testDoc;
  DeserializationError err = deserializeJson(testDoc, server.arg("plain"));
  if (err) { server.send(400, "text/plain", "JSON inválido: " + String(err.c_str())); return; }
  if (!testDoc.containsKey("events")) { server.send(400, "text/plain", "AST inválido: falta 'events'"); return; }

  // Guardar en LittleFS
  File f = LittleFS.open(WSL_SCRIPT_FILE, "w");
  if (!f) { server.send(500, "text/plain", "Error escribiendo LittleFS"); return; }
  f.print(server.arg("plain"));
  f.close();

  // Recargar intérprete en caliente
  bool ok = wsl_load();
  if (ok) {
    Serial.println("[WSL] Script actualizado via hot-reload");
    server.send(200, "application/json", "{\\"ok\\":true,\\"msg\\":\\"Script recargado\\"}");
  } else {
    server.send(500, "application/json", "{\\"ok\\":false,\\"msg\\":\\"Error al cargar AST\\"}");
  }
}

void handleScriptGet() {
  if (!LittleFS.exists(WSL_SCRIPT_FILE)) {
    server.send(404, "application/json", "{\\"error\\":\\"Sin script\\"}");
    return;
  }
  File f = LittleFS.open(WSL_SCRIPT_FILE, "r");
  server.streamFile(f, "application/json");
  f.close();
}` : `
// Modo LOCAL: hot-reload via Serial
// Enviar: {"cmd":"LOAD_SCRIPT","ast":<JSON>}\\n
void wsl_handle_serial_cmd(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;
  if (strcmp(doc["cmd"], "LOAD_SCRIPT") != 0) return;

  File f = LittleFS.open(WSL_SCRIPT_FILE, "w");
  if (!f) return;
  serializeJson(doc["ast"], f);
  f.close();
  wsl_load();
  Serial.println("{\\"ok\\":true,\\"msg\\":\\"Script recargado\\"}");
}
`}
`;
}

// Genera el código C++ para leer tags según el hardware configurado
function _genTagReads(hw) {
  if (!hw) return '  // sin hardware configurado';
  const id  = hw.device.id;
  const nat = hw.native;
  const exp = hw.expansion;
  const lines = [];

  nat.digital_in.forEach(p =>
    lines.push(`  if (t == "${id}.din.gpio${p.gpio}") return din_gpio${p.gpio} ? 1.0f : 0.0f;`));
  nat.digital_out.forEach(p =>
    lines.push(`  if (t == "${id}.dout.gpio${p.gpio}") return dout_gpio${p.gpio} ? 1.0f : 0.0f;`));
  nat.analog_in.forEach(p =>
    lines.push(`  if (t == "${id}.ain.adc${p.gpio}") return ain_adc${p.gpio};`));
  nat.pwm_out.forEach(p =>
    lines.push(`  if (t == "${id}.pwm.gpio${p.gpio}") return (float)pwm_gpio${p.gpio};`));

  if (exp.ic595?.enabled && exp.ic595.count > 0) {
    const n = exp.ic595.count * 8;
    for (let i = 0; i < n; i++)
      lines.push(`  if (t == "${id}.595.out.${i}") return sr595GetBit(${i}) ? 1.0f : 0.0f;`);
  }
  if (exp.ic165?.enabled && exp.ic165.count > 0) {
    const n = exp.ic165.count * 8;
    for (let i = 0; i < n; i++)
      lines.push(`  if (t == "${id}.165.in.${i}") return sr165GetBit(${i}) ? 1.0f : 0.0f;`);
  }
  if (exp.ads1115?.enabled && exp.ads1115.count > 0) {
    const n = exp.ads1115.count * 4;
    for (let i = 0; i < n; i++)
      lines.push(`  if (t == "${id}.ads.${Math.floor(i/4)}.ch${i%4}") return adsValues[${i}];`);
  }

  return lines.join('\n') || '  // sin tags nativos';
}

function _genTagWrites(hw) {
  if (!hw) return '  // sin hardware configurado';
  const id  = hw.device.id;
  const nat = hw.native;
  const exp = hw.expansion;
  const lines = [];

  nat.digital_out.forEach(p =>
    lines.push(`  if (t == "${id}.dout.gpio${p.gpio}") { dout_gpio${p.gpio} = val != 0; digitalWrite(${p.gpio}, dout_gpio${p.gpio}); return true; }`));
  nat.pwm_out.forEach((p, i) =>
    lines.push(`  if (t == "${id}.pwm.gpio${p.gpio}") { pwm_gpio${p.gpio} = (int)val; ledcWrite(${i}, pwm_gpio${p.gpio}); return true; }`));

  if (exp.ic595?.enabled && exp.ic595.count > 0) {
    const n = exp.ic595.count * 8;
    for (let i = 0; i < n; i++)
      lines.push(`  if (t == "${id}.595.out.${i}") { sr595SetBit(${i}, val != 0); return true; }`);
  }

  return lines.join('\n') || '  // sin tags de escritura';
}
