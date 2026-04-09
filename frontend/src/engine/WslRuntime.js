/**
 * WslRuntime.js — F6
 * Intérprete del AST generado por WslParser (F4).
 *
 * Uso:
 *   import { WslRuntime } from './WslRuntime.js';
 *
 *   const runtime = new WslRuntime({ hardware, script, transport });
 *
 *   // Callbacks opcionales para el canvas (F5)
 *   runtime.onLog       = ({ ts, msg }) => { ... };
 *   runtime.onAlarm     = ({ message, level, ts }) => { ... };
 *   runtime.onNotify    = (msg) => { ... };
 *   runtime.onTagChange = (tag, value, prev) => { ... };
 *
 *   await runtime.start();       // ejecuta ON STARTUP + inicia polling
 *   await runtime.emitClick(id); // llamado por el canvas al hacer click
 *   await runtime.stop();        // ejecuta ON SHUTDOWN + limpia todo
 */

import { WslParser }     from './WslParser.js';
import { WslParseError } from './WslErrors.js';
import { TagManager }    from './TagManager.js';
import { createTransport, TransportError } from './Transport.js';

// ─── Error de runtime ─────────────────────────────────────────────────────────

export class WslRuntimeError extends Error {
  constructor(message, node = null) {
    const loc = node ? ` (línea ${node.line}:${node.col})` : '';
    super(`[WslRuntime]${loc} ${message}`);
    this.name = 'WslRuntimeError';
    this.node = node;
  }
}

// ─── Límites de seguridad ────────────────────────────────────────────────────

const MAX_WHILE_ITERATIONS = 10_000;
const MAX_LOG_ENTRIES      = 500;
const POLL_INTERVAL_MS     = 2_000;

// ─── WslRuntime ───────────────────────────────────────────────────────────────

export class WslRuntime {
  /**
   * @param {object} options
   * @param {object}  options.hardware    — sección [HARDWARE]
   * @param {string}  options.script      — código WSL (texto plano)
   * @param {object}  [options.transport] — instancia Transport (si se omite, usa createTransport)
   * @param {object}  [options.design]    — sección [DESIGN] (para alarmas de objetos canvas)
   * @param {string}  [options.transportMode] — override de modo ('AUTO'|'REMOTE'|'LOCAL'|'SIMULATION')
   */
  constructor({ hardware, script, transport, design, transportMode } = {}) {
    this._hardware  = hardware   || null;
    this._script    = script     || '';
    this._design    = design     || null;
    this._transport = transport  || createTransport(hardware, transportMode);

    this._tagManager = new TagManager(hardware);
    this._variables  = new Map();   // variables de script (ámbito global)
    this._ast        = null;

    this._timers      = [];          // ids de setInterval para ON INTERVAL
    this._unsubs      = [];          // funciones de cancelación de onChange

    this._log    = [];
    this._alarms = [];
    this._running = false;

    // ── Callbacks externos (para React/canvas) ─────────────────────────────
    /** @type {Function|null} ({ ts, msg }) => void */
    this.onLog       = null;
    /** @type {Function|null} ({ message, level, ts, tag? }) => void */
    this.onAlarm     = null;
    /** @type {Function|null} (msg: string) => void */
    this.onNotify    = null;
    /** @type {Function|null} (tag, value, prev) => void */
    this.onTagChange = null;
    /** @type {Function|null} (error: Error) => void */
    this.onError     = null;
  }

  // ── API pública ───────────────────────────────────────────────────────────

  isRunning() { return this._running; }

  getTagValue(tag)  { return this._tagManager.getValue(tag); }
  getAllTagValues()  { return this._tagManager.snapshot(); }
  getLogs()         { return [...this._log]; }
  getActiveAlarms() { return this._alarms.filter(a => !a.acked); }
  getAllAlarms()     { return [...this._alarms]; }
  getVariables()     { return Object.fromEntries(this._variables.entries()); }
  getMode()         { return this._transport.getMode(); }
  getDevice()       { return this._transport.getDevice(); }

  /** Confirma (ack) una alarma por índice */
  ackAlarm(index) {
    if (this._alarms[index]) this._alarms[index].acked = true;
  }

  /**
   * Inicia el runtime.
   * 1. Parsea el script WSL
   * 2. Conecta el transporte
   * 3. Registra handlers de eventos
   * 4. Inicia polling de tags
   * 5. Ejecuta ON STARTUP
   */
  async start() {
    if (this._running) return;

    // 1. Parsear
    try {
      this._ast = new WslParser(this._script).parse();
    } catch (e) {
      const msg = e instanceof WslParseError
        ? `Error de sintaxis: ${e.wslMessage} (línea ${e.line}:${e.col})`
        : `Error al parsear script: ${e.message}`;
      this._addLog(msg, 'ERROR');
      this.onError?.(e);
      throw e;
    }

    // 2. Conectar transporte
    try {
      await this._transport.connect();
      this._addLog(`Transporte conectado — modo ${this.getMode()}: ${this.getDevice()}`);
    } catch (e) {
      this._addLog(`Error de conexión: ${e.message}`, 'ERROR');
      this.onError?.(e);
      throw e;
    }

    // 3. Inicializar variables globales declaradas con VAR
    for (const varDecl of (this._ast.vars || [])) {
      const initVal = varDecl.init
        ? await this._eval(varDecl.init, new Map())
        : 0;
      this._variables.set(varDecl.name, initVal);
    }

    // 4. Registrar handlers del script
    this._registerHandlers();

    // 5. Polling de telemetría
    this._startPolling();

    // 6. Lectura inicial para poblar el TagManager antes de ON STARTUP
    try {
      const initial = await this._transport.readAll();
      this._tagManager.applyTelemetry(initial);
    } catch { /* ignorar si falla — el polling lo resolverá */ }

    // 7. Ejecutar ON STARTUP
    this._running = true;
    await this._fireEventBlocks('STARTUP');

    this._addLog('Runtime iniciado');
  }

  /**
   * Detiene el runtime limpiamente.
   * Ejecuta ON SHUTDOWN, cancela timers y listeners.
   */
  async stop() {
    if (!this._running) return;

    try {
      await this._fireEventBlocks('SHUTDOWN');
    } catch { /* no bloquear el stop */ }

    // Cancelar todos los timers e intervalos
    this._timers.forEach(id => clearInterval(id));
    this._timers = [];

    // Cancelar suscripciones onChange
    this._unsubs.forEach(unsub => unsub());
    this._unsubs = [];

    this._tagManager.clear();

    try {
      this._transport.disconnect();
    } catch { /* ignorar */ }

    this._running = false;
    this._addLog('Runtime detenido');
  }

  /**
   * Llamado por el canvas cuando el usuario hace click en un objeto.
   * Dispara todos los bloques `ON CLICK "<objectId>"`.
   *
   * @param {string} objectId  — id del objeto del canvas
   */
  async emitClick(objectId) {
    if (!this._running) return;
    const blocks = this._ast?.events.filter(
      b => b.event.kind === 'CLICK' && b.event.objectId === objectId
    ) || [];
    for (const block of blocks) {
      await this._execBlock(block, new Map());
    }
  }

  // ── Registro de event handlers ────────────────────────────────────────────

  _registerHandlers() {
    for (const block of (this._ast?.events || [])) {
      const ev = block.event;

      switch (ev.kind) {

        case 'INTERVAL': {
          const ms = this._intervalToMs(ev.value, ev.unit);
          const id  = setInterval(async () => {
            try { await this._execBlock(block, new Map()); }
            catch (e) { this._addLog(`ON INTERVAL: ${e.message}`, 'ERROR'); }
          }, ms);
          this._timers.push(id);
          this._addLog(`Registrado ON INTERVAL ${ev.value}${ev.unit} (${ms} ms)`);
          break;
        }

        case 'CHANGE': {
          const unsub = this._tagManager.onChange(ev.tag, async (value, prev) => {
            try {
              const scope = new Map([
                ['__tag',   ev.tag],
                ['__value', value],
                ['__prev',  prev],
              ]);
              await this._execBlock(block, scope);
            } catch (e) { this._addLog(`ON CHANGE "${ev.tag}": ${e.message}`, 'ERROR'); }
          });
          this._unsubs.push(unsub);
          break;
        }

        case 'ALARM': {
          // Monitorear el tag para disparar cuando entre en alarma
          const unsub = this._tagManager.onChange(ev.tag, async (value) => {
            if (this._isInAlarm(ev.tag, value)) {
              try { await this._execBlock(block, new Map([['__alarmTag', ev.tag], ['__alarmValue', value]])); }
              catch (e) { this._addLog(`ON ALARM "${ev.tag}": ${e.message}`, 'ERROR'); }
            }
          });
          this._unsubs.push(unsub);
          break;
        }

        // STARTUP, SHUTDOWN y CLICK se manejan en start/stop/emitClick
        case 'STARTUP':
        case 'SHUTDOWN':
        case 'CLICK':
          break;
      }
    }
  }

  // ── Polling de telemetría ─────────────────────────────────────────────────

  _startPolling() {
    const id = setInterval(async () => {
      try {
        const data = await this._transport.readAll();
        for (const [tag, value] of Object.entries(data)) {
          const prev = this._tagManager.getValue(tag);
          this._tagManager.setValue(tag, value);
          if (prev !== value) {
            this.onTagChange?.(tag, value, prev);
            this._checkDesignAlarms(tag, value);
          }
        }
      } catch (e) {
        if (!(e instanceof TransportError)) return;
        this._addLog(`Polling falló: ${e.message}`, 'WARN');
      }
    }, POLL_INTERVAL_MS);
    this._timers.push(id);
  }

  // ── Alarmas desde objetos del canvas [DESIGN] ─────────────────────────────

  _checkDesignAlarms(tag, value) {
    if (!this._design?.screens) return;
    for (const screen of this._design.screens) {
      for (const obj of (screen.objects || [])) {
        if (obj.tag !== tag || !obj.alarm?.enabled) continue;
        const { min, max, severity } = obj.alarm;
        const inAlarm = (min !== null && value < min) || (max !== null && value > max);
        if (inAlarm) {
          const msg = `${obj.label || tag}: valor ${value} fuera de rango [${min ?? '—'}, ${max ?? '—'}]`;
          this._emitAlarm(msg, severity || 'WARN', tag);
        }
      }
    }
  }

  _isInAlarm(tag, value) {
    if (!this._design?.screens) return false;
    for (const screen of this._design.screens) {
      for (const obj of (screen.objects || [])) {
        if (obj.tag !== tag || !obj.alarm?.enabled) continue;
        const { min, max } = obj.alarm;
        if ((min !== null && value < min) || (max !== null && value > max)) return true;
      }
    }
    return false;
  }

  // ── Ejecución de bloques ──────────────────────────────────────────────────

  async _fireEventBlocks(kind) {
    const blocks = this._ast?.events.filter(b => b.event.kind === kind) || [];
    for (const block of blocks) {
      await this._execBlock(block, new Map());
    }
  }

  async _execBlock(block, scope) {
    await this._execStatements(block.body, new Map(scope));
  }

  async _execStatements(stmts, scope) {
    for (const stmt of stmts) {
      await this._execStatement(stmt, scope);
    }
  }

  async _execStatement(stmt, scope) {
    switch (stmt.type) {

      // ── VAR nombre [= expr]  (declaración local dentro de un bloque) ──────
      case 'VarDeclaration': {
        const initVal = stmt.init
          ? await this._eval(stmt.init, scope)
          : 0;
        scope.set(stmt.name, initVal);
        this._variables.set(stmt.name, initVal);
        break;
      }

      // ── Asignación de variable ────────────────────────────────────────────
      case 'AssignStatement': {
        const value = await this._eval(stmt.value, scope);
        scope.set(stmt.name, value);
        this._variables.set(stmt.name, value);  // ámbito global persistente
        break;
      }

      // ── SET(obj.ACCION) ── activar acción en objeto SCADA ─────────────────
      case 'SetActionStatement': {
        const { object, action } = stmt;
        // Resolver acción a valor numérico para el transporte
        let value;
        switch (action) {
          case 'ON':     value = 1; break;
          case 'OFF':    value = 0; break;
          case 'OPEN':   value = 1; break;
          case 'CLOSE':  value = 0; break;
          case 'TOGGLE': {
            const cur = this._tagManager.getValue(object)
                     ?? this._variables.get(object)
                     ?? 0;
            value = cur ? 0 : 1;
            break;
          }
          default:
            // Para acciones como VALUE — es lectura, no escritura; ignorar silenciosamente
            this._addLog(`SET(${object}.${action}): acción no escribible`, 'WARN');
            return;
        }
        // Intentar escribir al transporte por tag (usa el label del objeto como tag)
        try {
          await this._transport.write(object, value);
        } catch { /* transporte puede no conocer el tag — ignorar */ }
        const prev = this._tagManager.getValue(object);
        this._tagManager.setValue(object, value);
        this._variables.set(object, value);
        this.onTagChange?.(object, value, prev);
        break;
      }

      // ── SET("tag", valor) ─────────────────────────────────────────────────
      case 'SetStatement': {
        const value = await this._eval(stmt.value, scope);
        // stmt.tag puede ser string (tag de hardware) o un nodo Identifier (variable local)
        const tagName = typeof stmt.tag === 'string' ? stmt.tag : stmt.tag?.name ?? String(stmt.tag);
        // Si el tag es una variable conocida, asignar como variable
        if (this._variables.has(tagName) || scope.has(tagName)) {
          scope.set(tagName, value);
          this._variables.set(tagName, value);
        } else {
          // Escribir como tag de hardware
          try {
            await this._transport.write(tagName, value);
          } catch { /* ignorar si no existe el tag */ }
          const prev = this._tagManager.getValue(tagName);
          this._tagManager.setValue(tagName, value);
          this.onTagChange?.(tagName, value, prev);
        }
        break;
      }

      // ── ALARM("msg", LEVEL) ───────────────────────────────────────────────
      case 'AlarmStatement': {
        this._emitAlarm(stmt.message, stmt.level);
        break;
      }

      // ── LOG("msg") ────────────────────────────────────────────────────────
      case 'LogStatement': {
        const msg = await this._eval(stmt.message, scope);
        this._addLog(String(msg));
        break;
      }

      // ── NOTIFY("msg") ─────────────────────────────────────────────────────
      case 'NotifyStatement': {
        const msg = await this._eval(stmt.message, scope);
        this.onNotify?.(String(msg));
        this._addLog(`[NOTIFY] ${msg}`);
        break;
      }

      // ── CALL("endpoint", payload) ─────────────────────────────────────────
      case 'CallStatement': {
        const endpoint = String(await this._eval(stmt.endpoint, scope));
        const payload  = await this._eval(stmt.payload, scope);
        try {
          const base = this._getBaseUrl();
          const res  = await fetch(`${base}${endpoint}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
            signal:  AbortSignal.timeout(5000),
          });
          const result = await res.json();
          scope.set('__callResult', result);
        } catch (e) {
          this._addLog(`CALL "${endpoint}" falló: ${e.message}`, 'WARN');
        }
        break;
      }

      // ── WAIT(ms) ──────────────────────────────────────────────────────────
      case 'WaitStatement': {
        const ms = Number(await this._eval(stmt.duration, scope));
        await new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
        break;
      }

      // ── IF / THEN / ELSE / END ────────────────────────────────────────────
      case 'IfStatement': {
        const cond = await this._eval(stmt.condition, scope);
        const branch = this._isTruthy(cond) ? stmt.consequent : stmt.alternate;
        await this._execStatements(branch, scope);
        break;
      }

      // ── WHILE / DO / END ─────────────────────────────────────────────────
      case 'WhileStatement': {
        let guard = 0;
        while (this._isTruthy(await this._eval(stmt.condition, scope))) {
          if (++guard > MAX_WHILE_ITERATIONS) {
            this._addLog('WHILE: límite de iteraciones alcanzado (posible bucle infinito)', 'WARN');
            break;
          }
          await this._execStatements(stmt.body, scope);
        }
        break;
      }

      // ── FOR x FROM n TO m / END ───────────────────────────────────────────
      case 'ForStatement': {
        const from = Number(await this._eval(stmt.from, scope));
        const to   = Number(await this._eval(stmt.to,   scope));
        for (let i = from; i <= to; i++) {
          scope.set(stmt.variable, i);
          await this._execStatements(stmt.body, scope);
        }
        scope.delete(stmt.variable);
        break;
      }

      default:
        this._addLog(`Sentencia desconocida en runtime: ${stmt.type}`, 'WARN');
    }
  }

  // ── Evaluación de expresiones ─────────────────────────────────────────────

  async _eval(expr, scope) {
    switch (expr.type) {

      case 'NumberLiteral':  return expr.value;
      case 'StringLiteral':  return expr.value;
      case 'BooleanLiteral': return expr.value;

      case 'Identifier': {
        if (scope.has(expr.name))          return scope.get(expr.name);
        if (this._variables.has(expr.name)) return this._variables.get(expr.name);
        // Compatibilidad con TRUE/FALSE escritos como identifiers
        const u = expr.name.toUpperCase();
        if (u === 'TRUE')  return true;
        if (u === 'FALSE') return false;
        // Podría ser un tag directo (sin READ)
        const tagVal = this._tagManager.getValue(expr.name);
        if (tagVal !== null) return tagVal;
        return null;
      }

      case 'ReadCall': {
        // Usar el valor cacheado en TagManager primero
        const cached = this._tagManager.getValue(expr.tag);
        if (cached !== null) return cached;
        // Si no hay cache, pedir al transporte
        try {
          const all = await this._transport.readAll();
          const val = all[expr.tag] ?? null;
          if (val !== null) this._tagManager.setValue(expr.tag, val);
          return val;
        } catch {
          return null;
        }
      }

      case 'ModeCall':   return this._transport.getMode();
      case 'DeviceCall': return this._transport.getDevice();
      case 'NowCall':    return new Date().toISOString();

      case 'BinaryExpression': {
        const left  = await this._eval(expr.left,  scope);
        const right = await this._eval(expr.right, scope);
        return this._evalBinary(expr.operator, left, right);
      }

      case 'UnaryExpression': {
        const operand = await this._eval(expr.operand, scope);
        if (expr.operator === 'NOT') return !this._isTruthy(operand);
        if (expr.operator === '-')   return -Number(operand);
        return operand;
      }

      default:
        return null;
    }
  }

  _evalBinary(op, left, right) {
    switch (op) {
      case '+':
        return (typeof left === 'string' || typeof right === 'string')
          ? String(left)  + String(right)
          : Number(left)  + Number(right);
      case '-':   return Number(left) - Number(right);
      case '*':   return Number(left) * Number(right);
      case '/':   return Number(right) === 0 ? null : Number(left) / Number(right);
      case '==':  return left == right;   // eslint-disable-line eqeqeq
      case '!=':  return left != right;   // eslint-disable-line eqeqeq
      case '<':   return Number(left) <  Number(right);
      case '>':   return Number(left) >  Number(right);
      case '<=':  return Number(left) <= Number(right);
      case '>=':  return Number(left) >= Number(right);
      case 'AND': return this._isTruthy(left) && this._isTruthy(right);
      case 'OR':  return this._isTruthy(left) || this._isTruthy(right);
      default:    return null;
    }
  }

  _isTruthy(val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number')  return val !== 0;
    if (typeof val === 'string')  return val.length > 0 && val.toUpperCase() !== 'FALSE';
    return Boolean(val);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _intervalToMs(value, unit) {
    const n = Number(value);
    switch (unit) {
      case 's': return n * 1_000;
      case 'm': return n * 60_000;
      case 'h': return n * 3_600_000;
      default:  return n * 1_000;
    }
  }

  _getBaseUrl() {
    const conn = this._hardware?.device?.connection?.remote;
    if (conn?.ip) return `http://${conn.ip}:${conn.port || 80}`;
    return '';
  }

  _emitAlarm(message, level, tag = null) {
    const alarm = { message, level, tag, ts: new Date().toISOString(), acked: false };
    this._alarms.push(alarm);
    this.onAlarm?.(alarm);
    this._addLog(`[ALARM:${level}] ${message}`, 'ALARM');
  }

  _addLog(msg, type = 'INFO') {
    const entry = { ts: new Date().toISOString(), msg, type };
    this._log.push(entry);
    if (this._log.length > MAX_LOG_ENTRIES) this._log.shift();
    this.onLog?.(entry);
  }
}
