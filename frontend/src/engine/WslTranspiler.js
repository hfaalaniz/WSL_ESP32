/**
 * WslTranspiler.js
 * Convierte un AST de WslParser a código C++ para ESP32.
 *
 * Uso:
 *   import { WslTranspiler } from './WslTranspiler.js';
 *   const cpp = new WslTranspiler(ast, hardware).transpile();
 *
 * El código generado se integra al firmware .ino producido por FirmwareGenerator.
 */

import { WslParser } from './WslParser.js';

// ─── Transpilador ─────────────────────────────────────────────────────────────

export class WslTranspiler {
  /**
   * @param {object} ast       AST producido por WslParser.parse()
   * @param {object} hardware  Configuración de hardware (para resolver tags a variables C++)
   */
  constructor(ast, hardware) {
    this._ast      = ast;
    this._hw       = hardware;
    this._deviceId = hardware?.device?.id || 'device';
    this._indent   = 0;
    this._vars     = new Set(); // variables de script declaradas
    this._intervals = [];       // {index, valueMs, body}
    this._errors   = [];
  }

  // ── API pública ─────────────────────────────────────────────────────────────

  transpile() {
    const events = this._ast?.events || [];

    const startup  = events.filter(e => e.event.kind === 'STARTUP');
    const shutdown = events.filter(e => e.event.kind === 'SHUTDOWN');
    const intervals= events.filter(e => e.event.kind === 'INTERVAL');
    const changes  = events.filter(e => e.event.kind === 'CHANGE');
    const clicks   = events.filter(e => e.event.kind === 'CLICK');
    const alarms   = events.filter(e => e.event.kind === 'ALARM');

    // Colectar variables únicas de todos los bloques
    events.forEach(e => this._collectVars(e.body));

    const lines = [];

    // Declaraciones de variables de script
    if (this._vars.size > 0) {
      lines.push('// Variables de script WSL');
      for (const v of this._vars) {
        lines.push(`float ${this._sanitizeVar(v)} = 0;`);
      }
      lines.push('');
    }

    // Timers para ON INTERVAL
    intervals.forEach((ev, i) => {
      const ms = this._intervalToMs(ev.event.value, ev.event.unit);
      lines.push(`unsigned long _wsl_interval${i}_last = 0;`);
      lines.push(`const unsigned long _wsl_interval${i}_ms = ${ms}UL;`);
    });
    if (intervals.length > 0) lines.push('');

    // Snapshot de tags para ON CHANGE
    changes.forEach((ev, i) => {
      const cVar = this._tagToVar(ev.event.tag);
      lines.push(`float _wsl_prev_${i} = 0; // ON CHANGE "${ev.event.tag}"`);
    });
    if (changes.length > 0) lines.push('');

    // ON STARTUP → wsl_startup()
    lines.push('void wsl_startup() {');
    if (startup.length > 0) {
      startup.forEach(ev => {
        this._indent = 1;
        lines.push(...this._emitStatements(ev.body));
      });
    }
    lines.push('}', '');

    // ON SHUTDOWN → wsl_shutdown()
    lines.push('void wsl_shutdown() {');
    if (shutdown.length > 0) {
      shutdown.forEach(ev => {
        this._indent = 1;
        lines.push(...this._emitStatements(ev.body));
      });
    }
    lines.push('}', '');

    // ON INTERVAL N → wsl_check_intervals() llamado desde loop()
    intervals.forEach((ev, i) => {
      lines.push(`void wsl_interval_${i}() {`);
      this._indent = 1;
      lines.push(...this._emitStatements(ev.body));
      lines.push('}', '');
    });

    // ON CHANGE → wsl_check_changes() llamado desde loop()
    if (changes.length > 0) {
      changes.forEach((ev, i) => {
        const cVar = this._tagToVar(ev.event.tag);
        lines.push(`void wsl_change_${i}() {`);
        lines.push(`  float _cur = ${cVar};`);
        lines.push(`  if (_cur != _wsl_prev_${i}) {`);
        this._indent = 2;
        lines.push(...this._emitStatements(ev.body));
        lines.push(`    _wsl_prev_${i} = _cur;`);
        lines.push('  }');
        lines.push('}', '');
      });
    }

    // ON CLICK → wsl_click(String objId)
    if (clicks.length > 0) {
      lines.push('void wsl_click(String objId) {');
      clicks.forEach(ev => {
        lines.push(`  if (objId == "${ev.event.objectId}") {`);
        this._indent = 2;
        lines.push(...this._emitStatements(ev.body));
        lines.push('  }');
      });
      lines.push('}', '');
    }

    // ON ALARM → wsl_alarm(String tag, float value)
    if (alarms.length > 0) {
      lines.push('void wsl_alarm(String tag, float value) {');
      alarms.forEach(ev => {
        lines.push(`  if (tag == "${ev.event.tag}") {`);
        this._indent = 2;
        lines.push(...this._emitStatements(ev.body));
        lines.push('  }');
      });
      lines.push('}', '');
    }

    // wsl_check_intervals() — llamado en loop()
    lines.push('void wsl_check_intervals() {');
    lines.push('  unsigned long now = millis();');
    intervals.forEach((_, i) => {
      lines.push(`  if (now - _wsl_interval${i}_last >= _wsl_interval${i}_ms) {`);
      lines.push(`    _wsl_interval${i}_last = now;`);
      lines.push(`    wsl_interval_${i}();`);
      lines.push('  }');
    });
    lines.push('}', '');

    // wsl_check_changes() — llamado en loop()
    if (changes.length > 0) {
      lines.push('void wsl_check_changes() {');
      changes.forEach((_, i) => lines.push(`  wsl_change_${i}();`));
      lines.push('}', '');
    } else {
      lines.push('void wsl_check_changes() {}', '');
    }

    return lines.join('\n');
  }

  /** Errores de transpilación (tags no resueltos, etc.) */
  getErrors() { return this._errors; }

  // ── Helpers internos ────────────────────────────────────────────────────────

  _pad() { return '  '.repeat(this._indent); }

  _intervalToMs(value, unit) {
    const n = Number(value);
    if (unit === 's') return n * 1000;
    if (unit === 'm') return n * 60000;
    if (unit === 'h') return n * 3600000;
    return n * 1000;
  }

  /** Convierte un tag WSL a la variable C++ correspondiente */
  _tagToVar(tag) {
    const hw = this._hw;
    if (!hw) return `0 /* tag ${tag} sin hardware */`;
    const id = hw.device.id;
    const nat = hw.native;
    const exp = hw.expansion;

    // din.gpioN
    const dinMatch = tag.match(/^(?:[^.]+\.)?din\.gpio(\d+)$/);
    if (dinMatch) return `din_gpio${dinMatch[1]}`;

    // dout.gpioN
    const doutMatch = tag.match(/^(?:[^.]+\.)?dout\.gpio(\d+)$/);
    if (doutMatch) return `dout_gpio${doutMatch[1]}`;

    // ain.adcN
    const ainMatch = tag.match(/^(?:[^.]+\.)?ain\.adc(\d+)$/);
    if (ainMatch) return `ain_adc${ainMatch[1]}`;

    // pwm.gpioN
    const pwmMatch = tag.match(/^(?:[^.]+\.)?pwm\.gpio(\d+)$/);
    if (pwmMatch) return `pwm_gpio${pwmMatch[1]}`;

    // 595.out.N → sr595GetBit(N) / sr595SetBit(N,v)
    const sr595Match = tag.match(/^(?:[^.]+\.)?595\.out\.(\d+)$/);
    if (sr595Match) return `sr595GetBit(${sr595Match[1]})`;

    // 165.in.N
    const sr165Match = tag.match(/^(?:[^.]+\.)?165\.in\.(\d+)$/);
    if (sr165Match) return `sr165GetBit(${sr165Match[1]})`;

    // ads.N.chM
    const adsMatch = tag.match(/^(?:[^.]+\.)?ads\.(\d+)\.ch(\d+)$/);
    if (adsMatch) return `adsValues[${parseInt(adsMatch[1]) * 4 + parseInt(adsMatch[2])}]`;

    // obj.PROP (referencia a objeto del canvas por etiqueta)
    // En modo autónomo se ignora — solo aplica cuando SCADA está conectado
    this._errors.push(`Tag '${tag}' no mapeado a variable C++`);
    return `0 /* ${tag} */`;
  }

  /** Para SET: necesitamos la expresión de escritura, no de lectura */
  _tagToSetExpr(tag, valueExpr) {
    const sr595Match = tag.match(/^(?:[^.]+\.)?595\.out\.(\d+)$/);
    if (sr595Match) return `sr595SetBit(${sr595Match[1]}, ${valueExpr})`;

    const doutMatch = tag.match(/^(?:[^.]+\.)?dout\.gpio(\d+)$/);
    if (doutMatch) return `{ dout_gpio${doutMatch[1]} = ${valueExpr}; digitalWrite(${doutMatch[1]}, dout_gpio${doutMatch[1]}); }`;

    const pwmMatch = tag.match(/^(?:[^.]+\.)?pwm\.gpio(\d+)$/);
    if (pwmMatch) return `{ pwm_gpio${pwmMatch[1]} = ${valueExpr}; ledcWrite(${pwmMatch[1]}, ${valueExpr}); }`;

    // Fallback: asignar variable de lectura (para sensores, ignorar)
    return `/* SET "${tag}" ignorado en autonomía: solo lectura */`;
  }

  _sanitizeVar(name) {
    return '_wsl_' + name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /** Recorre el AST para colectar nombres de variables de script */
  _collectVars(stmts) {
    if (!Array.isArray(stmts)) return;
    for (const s of stmts) {
      if (s.type === 'AssignStatement') this._vars.add(s.name);
      if (s.type === 'ForStatement')    this._vars.add(s.variable);
      if (s.consequent) this._collectVars(s.consequent);
      if (s.alternate)  this._collectVars(s.alternate);
      if (s.body)       this._collectVars(s.body);
    }
  }

  // ── Emisión de sentencias ────────────────────────────────────────────────────

  _emitStatements(stmts) {
    const lines = [];
    for (const s of stmts) {
      lines.push(...this._emitStatement(s));
    }
    return lines;
  }

  _emitStatement(node) {
    const p = this._pad();
    switch (node.type) {

      case 'SetStatement': {
        const val = this._emitExpr(node.value);
        return [`${p}${this._tagToSetExpr(node.tag, val)};`];
      }

      case 'LogStatement': {
        const msg = this._emitExpr(node.message);
        return [
          `${p}{ String _msg = String(${msg}); Serial.println("[LOG] " + _msg); wsl_append_log("LOG", _msg); }`,
        ];
      }

      case 'AlarmStatement': {
        const msg = JSON.stringify(node.message);
        const lvl = JSON.stringify(node.level);
        return [
          `${p}{ wsl_append_log(${lvl}, String(${msg})); Serial.println("[ALARM:${node.level}] " + String(${msg})); }`,
        ];
      }

      case 'NotifyStatement': {
        const msg = this._emitExpr(node.message);
        return [`${p}Serial.println("[NOTIFY] " + String(${msg}));`];
      }

      case 'WaitStatement': {
        const ms = this._emitExpr(node.duration);
        return [`${p}delay(${ms});`];
      }

      case 'CallStatement':
        // CALL solo tiene sentido en modo REMOTE; en autónomo se ignora
        return [`${p}/* CALL ignorado en modo autónomo */`];

      case 'AssignStatement': {
        const val = this._emitExpr(node.value);
        return [`${p}${this._sanitizeVar(node.name)} = ${val};`];
      }

      case 'IfStatement': {
        const cond = this._emitExpr(node.condition);
        const lines = [`${p}if (${cond}) {`];
        const prevIndent = this._indent;
        this._indent++;
        lines.push(...this._emitStatements(node.consequent));
        if (node.alternate?.length > 0) {
          this._indent = prevIndent;
          lines.push(`${p}} else {`);
          this._indent++;
          lines.push(...this._emitStatements(node.alternate));
        }
        this._indent = prevIndent;
        lines.push(`${p}}`);
        return lines;
      }

      case 'WhileStatement': {
        const cond = this._emitExpr(node.condition);
        const lines = [`${p}while (${cond}) {`];
        const prevIndent = this._indent;
        this._indent++;
        lines.push(...this._emitStatements(node.body));
        this._indent = prevIndent;
        lines.push(`${p}}`);
        return lines;
      }

      case 'ForStatement': {
        const v    = this._sanitizeVar(node.variable);
        const from = this._emitExpr(node.from);
        const to   = this._emitExpr(node.to);
        const lines = [`${p}for (float ${v} = ${from}; ${v} <= ${to}; ${v}++) {`];
        const prevIndent = this._indent;
        this._indent++;
        lines.push(...this._emitStatements(node.body));
        this._indent = prevIndent;
        lines.push(`${p}}`);
        return lines;
      }

      default:
        return [`${p}/* nodo ${node.type} no soportado en C++ */`];
    }
  }

  // ── Emisión de expresiones ───────────────────────────────────────────────────

  _emitExpr(node) {
    if (!node) return '0';
    switch (node.type) {

      case 'NumberLiteral':  return String(node.value);
      case 'StringLiteral':  return `String("${node.value.replace(/"/g, '\\"')}")`;
      case 'BooleanLiteral': return node.value ? '1' : '0';

      case 'Identifier':
        // Variable de script
        return this._sanitizeVar(node.name);

      case 'ReadCall':
        return this._tagToVar(node.tag);

      case 'ModeCall':
        return `String("AUTO")`;

      case 'DeviceCall':
        return `String("${this._deviceId}")`;

      case 'NowCall':
        return `String(millis())`;

      case 'BinaryExpression': {
        const l = this._emitExpr(node.left);
        const r = this._emitExpr(node.right);
        const opMap = { 'OR': '||', 'AND': '&&', '==': '==', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };
        const op = opMap[node.operator] || node.operator;
        return `(${l} ${op} ${r})`;
      }

      case 'UnaryExpression': {
        const operand = this._emitExpr(node.operand);
        if (node.operator === 'NOT') return `!(${operand})`;
        if (node.operator === '-')   return `-(${operand})`;
        return operand;
      }

      default:
        return `0 /* expr ${node.type} */`;
    }
  }
}

// ── Función de conveniencia ───────────────────────────────────────────────────

/**
 * Transpila un script WSL a C++ directamente desde el texto fuente.
 * @param {string} script   Código fuente WSL
 * @param {object} hardware Configuración de hardware
 * @returns {{ code: string, errors: string[] }}
 */
export function transpileWsl(script, hardware) {
  if (!script?.trim()) return { code: '', errors: [] };
  try {
    const ast = new WslParser(script).parse();
    const t   = new WslTranspiler(ast, hardware);
    const code = t.transpile();
    return { code, errors: t.getErrors() };
  } catch (e) {
    return { code: '', errors: [`Error de parseo: ${e.message}`] };
  }
}
