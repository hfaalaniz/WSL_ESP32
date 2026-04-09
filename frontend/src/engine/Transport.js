/**
 * Transport.js
 * Capa de comunicación con el ESP32.
 *
 * Clases exportadas:
 *   RemoteTransport     — HTTP REST (WiFi)
 *   LocalTransport      — Web Serial API (USB)
 *   AutoTransport       — prueba REMOTE, cae a LOCAL, cae a SIMULATION
 *   SimulationTransport — datos simulados (sin hardware)
 *
 * Protocolo Serial (LOCAL):
 *   → {"cmd":"READ_ALL"}\n
 *   ← {"tag1":val1,"tag2":val2,...}\n
 *
 *   → {"cmd":"SET","tag":"device.595.out.0","value":1}\n
 *   ← {"ok":true}\n
 *
 *   → {"cmd":"PING"}\n
 *   ← {"ok":true,"uptime":12345}\n
 */

// ─── Error de transporte ──────────────────────────────────────────────────────

export class TransportError extends Error {
  constructor(message, transport = 'unknown') {
    super(`[Transport:${transport}] ${message}`);
    this.name = 'TransportError';
    this.transport = transport;
  }
}

// ─── RemoteTransport (HTTP REST) ─────────────────────────────────────────────

export class RemoteTransport {
  /**
   * @param {string} ip           — IP del ESP32
   * @param {number} port         — Puerto HTTP (default 80)
   * @param {number} timeoutMs    — Timeout por request
   */
  constructor(ip, port = 80, timeoutMs = 3000) {
    this._ip        = ip;
    this._port      = port;
    this._timeoutMs = timeoutMs;
    this._baseUrl   = `http://${ip}:${port}`;
    this._connected = false;
  }

  getMode()   { return 'REMOTE'; }
  getDevice() { return `${this._ip}:${this._port}`; }
  isConnected() { return this._connected; }

  async connect() {
    try {
      const result = await this._get('/api/ping');
      this._connected = !!result?.ok;
      if (!this._connected) throw new TransportError('El dispositivo no respondió al ping', 'REMOTE');
      return true;
    } catch (e) {
      this._connected = false;
      if (e instanceof TransportError) throw e;
      throw new TransportError(`No se pudo conectar a ${this._baseUrl}: ${e.message}`, 'REMOTE');
    }
  }

  disconnect() {
    this._connected = false;
  }

  /**
   * Lee todos los tags de una vez.
   * @returns {Promise<Object>} { tag: value, ... }
   */
  async readAll() {
    try {
      return await this._get('/api/telemetry');
    } catch (e) {
      throw new TransportError(`readAll falló: ${e.message}`, 'REMOTE');
    }
  }

  /**
   * Escribe un valor en un tag.
   */
  async write(tag, value) {
    try {
      await this._post('/api/command', { tag, value });
    } catch (e) {
      throw new TransportError(`write(${tag}) falló: ${e.message}`, 'REMOTE');
    }
  }

  // ── Helpers HTTP ──────────────────────────────────────────────────────────

  async _get(path) {
    const res = await fetch(`${this._baseUrl}${path}`, {
      signal: AbortSignal.timeout(this._timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this._baseUrl}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(this._timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

// ─── LocalTransport (Web Serial API) ─────────────────────────────────────────

export class LocalTransport {
  /**
   * @param {number} baudRate  — Velocidad serial (default 115200)
   */
  constructor(baudRate = 115200) {
    this._baudRate  = baudRate;
    this._port      = null;
    this._reader    = null;
    this._writer    = null;
    this._encoder   = new TextEncoder();
    this._decoder   = new TextDecoder();
    this._buffer    = '';
    this._connected = false;

    // Cola de promesas pendientes (un request a la vez)
    this._pending = null;
  }

  getMode()   { return 'LOCAL'; }
  getDevice() { return this._port?.getInfo?.()?.usbProductId ?? 'serial'; }
  isConnected() { return this._connected; }

  /**
   * Abre el diálogo de selección de puerto serial del navegador.
   * Requiere Chrome/Edge con Web Serial API.
   */
  async connect() {
    if (!navigator?.serial) {
      throw new TransportError(
        'Web Serial API no disponible. Usá Chrome 89+ con https o localhost',
        'LOCAL'
      );
    }

    try {
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: this._baudRate });

      this._writer = this._port.writable.getWriter();
      this._startReading();
      this._connected = true;

      // Verificar que el ESP32 responde
      const pong = await this._sendCommand({ cmd: 'PING' });
      if (!pong?.ok) throw new TransportError('ESP32 no respondió al PING', 'LOCAL');

      return true;
    } catch (e) {
      this._connected = false;
      if (e instanceof TransportError) throw e;
      throw new TransportError(`No se pudo abrir el puerto serial: ${e.message}`, 'LOCAL');
    }
  }

  async disconnect() {
    this._connected = false;
    try {
      this._reader?.cancel();
      await this._writer?.close();
      await this._port?.close();
    } catch { /* ya cerrado */ }
    this._port = this._reader = this._writer = null;
  }

  async readAll() {
    const result = await this._sendCommand({ cmd: 'READ_ALL' });
    return result ?? {};
  }

  async write(tag, value) {
    const result = await this._sendCommand({ cmd: 'SET', tag, value });
    if (!result?.ok) throw new TransportError(`SET ${tag} rechazado por el dispositivo`, 'LOCAL');
  }

  // ── I/O serial ────────────────────────────────────────────────────────────

  async _sendCommand(obj) {
    if (!this._connected || !this._writer) {
      throw new TransportError('Puerto serial no conectado', 'LOCAL');
    }

    const line   = JSON.stringify(obj) + '\n';
    const data   = this._encoder.encode(line);
    await this._writer.write(data);

    // Esperar respuesta (línea JSON completa)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending = null;
        reject(new TransportError('Timeout esperando respuesta serial', 'LOCAL'));
      }, 3000);

      this._pending = (responseLine) => {
        clearTimeout(timeout);
        this._pending = null;
        try {
          resolve(JSON.parse(responseLine));
        } catch {
          reject(new TransportError(`Respuesta serial inválida: ${responseLine}`, 'LOCAL'));
        }
      };
    });
  }

  async _startReading() {
    try {
      this._reader = this._port.readable.getReader();
      while (this._connected) {
        const { value, done } = await this._reader.read();
        if (done) break;
        this._buffer += this._decoder.decode(value);

        // Procesar líneas completas
        let nl;
        while ((nl = this._buffer.indexOf('\n')) !== -1) {
          const line = this._buffer.slice(0, nl).trim();
          this._buffer = this._buffer.slice(nl + 1);
          if (line && this._pending) this._pending(line);
        }
      }
    } catch { /* desconexión */ }
    finally { this._reader?.releaseLock(); }
  }
}

// ─── SimulationTransport (sin hardware) ──────────────────────────────────────

export class SimulationTransport {
  /**
   * @param {object} hardware  — [HARDWARE] config para generar tags realistas
   * @param {number} noiseHz   — Frecuencia de variación de analógicos
   */
  constructor(hardware = null, noiseHz = 0.3) {
    this._simValues  = new Map();
    this._noiseHz    = noiseHz;
    this._connected  = false;
    this._hardware   = hardware;
    this._tickId     = null;

    this._initSimValues(hardware);
  }

  getMode()   { return 'SIMULATION'; }
  getDevice() { return 'sim://localhost'; }
  isConnected() { return this._connected; }

  async connect() {
    this._connected = true;
    // Simular variación de valores analógicos
    this._tickId = setInterval(() => this._tick(), 1000 / this._noiseHz);
    return true;
  }

  disconnect() {
    this._connected = false;
    if (this._tickId) clearInterval(this._tickId);
    this._tickId = null;
  }

  async readAll() {
    return Object.fromEntries(this._simValues);
  }

  async write(tag, value) {
    // En simulación, SET se aplica inmediatamente
    this._simValues.set(tag, value);
  }

  // ── Simulación ────────────────────────────────────────────────────────────

  _initSimValues(hw) {
    if (!hw) return;
    const id  = hw.device?.id || 'device';
    const nat = hw.native     || {};
    const exp = hw.expansion  || {};

    (nat.digital_in  || []).forEach(p => this._simValues.set(`${id}.din.gpio${p.gpio}`,  false));
    (nat.digital_out || []).forEach(p => this._simValues.set(`${id}.dout.gpio${p.gpio}`, false));
    (nat.analog_in   || []).forEach(p => this._simValues.set(`${id}.ain.adc${p.gpio}`,   this._rnd(0, 4095)));
    (nat.pwm_out     || []).forEach(p => this._simValues.set(`${id}.pwm.gpio${p.gpio}`,  0));

    const e595 = exp.ic595;
    if (e595?.enabled && e595.count > 0)
      for (let i = 0; i < e595.count * 8; i++) this._simValues.set(`${id}.595.out.${i}`, false);

    const e165 = exp.ic165;
    if (e165?.enabled && e165.count > 0)
      for (let i = 0; i < e165.count * 8; i++) this._simValues.set(`${id}.165.in.${i}`, false);

    (exp.ads1115?.devices || []).forEach((dev, di) =>
      (dev.channels || []).forEach(ch => {
        const min = ch.scale_min ?? 0, max = ch.scale_max ?? 100;
        this._simValues.set(`${id}.ads.${di}.ch${ch.ch}`, this._rnd(min, max));
      })
    );

    (exp.mcp23017?.devices || []).forEach((_, di) => {
      for (let i = 0; i < 8; i++) this._simValues.set(`${id}.mcp.${di}.a${i}`, false);
      for (let i = 0; i < 8; i++) this._simValues.set(`${id}.mcp.${di}.b${i}`, false);
    });
  }

  _tick() {
    // Variación aleatoria de analógicos ±2%
    for (const [tag, val] of this._simValues) {
      if (typeof val === 'number' && val > 1) {
        const noise = (Math.random() - 0.5) * val * 0.04;
        this._simValues.set(tag, parseFloat((val + noise).toFixed(3)));
      }
      // Cambio digital aleatorio (<0.5% de probabilidad por tick)
      if (typeof val === 'boolean' && Math.random() < 0.005) {
        this._simValues.set(tag, !val);
      }
    }
  }

  _rnd(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }
}

// ─── AutoTransport (detecta el modo automáticamente) ─────────────────────────

export class AutoTransport {
  /**
   * Prueba REMOTE → LOCAL → SIMULATION.
   * Expone la misma API que los transportes individuales.
   *
   * @param {object} hardware   — [HARDWARE] config
   */
  constructor(hardware) {
    this._hardware   = hardware;
    this._active     = null;
    this._connected  = false;
  }

  getMode()   { return this._active?.getMode()   ?? 'DISCONNECTED'; }
  getDevice() { return this._active?.getDevice() ?? '—'; }
  isConnected() { return this._connected; }

  async connect() {
    const conn   = this._hardware?.device?.connection;
    const remote = conn?.remote;
    const local  = conn?.local;

    // 1. Intentar REMOTE
    if (remote?.ip) {
      try {
        const t = new RemoteTransport(remote.ip, remote.port ?? 80, remote.timeout_ms ?? 3000);
        await t.connect();
        this._active    = t;
        this._connected = true;
        console.info('[AutoTransport] Modo REMOTE:', remote.ip);
        return true;
      } catch { /* cae al siguiente */ }
    }

    // 2. Intentar LOCAL (solo si el navegador soporta Web Serial)
    if (local && navigator?.serial) {
      try {
        const t = new LocalTransport(local.baud ?? 115200);
        await t.connect();
        this._active    = t;
        this._connected = true;
        console.info('[AutoTransport] Modo LOCAL: serial');
        return true;
      } catch { /* cae al siguiente */ }
    }

    // 3. Fallback: SIMULATION
    console.warn('[AutoTransport] Sin dispositivo — modo SIMULATION');
    const t = new SimulationTransport(this._hardware);
    await t.connect();
    this._active    = t;
    this._connected = true;
    return true;
  }

  disconnect() {
    this._active?.disconnect();
    this._active    = null;
    this._connected = false;
  }

  readAll()         { return this._active?.readAll()      ?? Promise.resolve({}); }
  write(tag, value) { return this._active?.write(tag, value) ?? Promise.resolve(); }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Crea el transporte correcto según el modo del dispositivo.
 *
 * @param {object} hardware  — sección [HARDWARE]
 * @param {string} [override] — 'REMOTE' | 'LOCAL' | 'SIMULATION' | 'AUTO'
 */
export function createTransport(hardware, override = null) {
  const mode = override?.toUpperCase()
    ?? hardware?.device?.mode?.toUpperCase()
    ?? 'AUTO';

  const conn   = hardware?.device?.connection;
  const remote = conn?.remote;
  const local  = conn?.local;

  switch (mode) {
    case 'REMOTE':
      if (!remote?.ip) throw new TransportError('Falta IP en config REMOTE', 'factory');
      return new RemoteTransport(remote.ip, remote.port ?? 80, remote.timeout_ms ?? 3000);

    case 'LOCAL':
      return new LocalTransport(local?.baud ?? 115200);

    case 'SIMULATION':
      return new SimulationTransport(hardware);

    case 'AUTO':
    default:
      return new AutoTransport(hardware);
  }
}
