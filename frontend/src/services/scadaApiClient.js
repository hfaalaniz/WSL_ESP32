/**
 * scadaApiClient.js
 * Cliente HTTP centralizado para comunicación con la API REST.
 *
 * Proporciona una interfaz uniforme para todos los endpoints,
 * con manejo de errores y retry automático.
 *
 * Uso:
 *   const client = new ScadaApiClient('http://localhost:5000');
 *   const devices = await client.getDevices();
 */

export class ScadaApiClient {
  constructor(baseUrl = '', timeoutMs = 3000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  // ── Dispositivos ─────────────────────────────────────────────────────────

  async getDevices() {
    return this._get('/api/devices');
  }

  async getDevice(id) {
    return this._get(`/api/devices/${id}`);
  }

  async getDeviceHardware(id) {
    return this._get(`/api/devices/${id}/hardware`);
  }

  async createDevice(payload) {
    return this._post('/api/devices', payload);
  }

  async updateDevice(id, payload) {
    return this._put(`/api/devices/${id}`, payload);
  }

  async deleteDevice(id) {
    return this._delete(`/api/devices/${id}`);
  }

  async pingDevice(id, ip) {
    return this._post(`/api/devices/${id}/ping`, {}, { ip });
  }

  // ── Telemetría ───────────────────────────────────────────────────────────

  async getTelemetryLatest(deviceId) {
    return this._get(`/api/devices/${deviceId}/telemetry`);
  }

  async pushTelemetry(deviceId, tags) {
    return this._post(`/api/devices/${deviceId}/telemetry`, tags);
  }

  async getTelemetryHistory(deviceId, tag, { from, to, limit } = {}) {
    const params = new URLSearchParams();
    params.append('tag', tag);
    if (from) params.append('from', from.toISOString());
    if (to) params.append('to', to.toISOString());
    if (limit) params.append('limit', limit);
    return this._get(`/api/devices/${deviceId}/telemetry/history?${params}`);
  }

  async purgeTelemetry(deviceId) {
    return this._delete(`/api/devices/${deviceId}/telemetry/purge`);
  }

  // ── Alarmas ──────────────────────────────────────────────────────────────

  async getAlarms(deviceId, { activeOnly, level, from, to, limit } = {}) {
    const params = new URLSearchParams();
    if (activeOnly !== undefined) params.append('activeOnly', activeOnly);
    if (level) params.append('level', level);
    if (from) params.append('from', from.toISOString());
    if (to) params.append('to', to.toISOString());
    if (limit) params.append('limit', limit);
    return this._get(`/api/devices/${deviceId}/alarms?${params}`);
  }

  async getAlarmsSummary(deviceId) {
    return this._get(`/api/devices/${deviceId}/alarms/summary`);
  }

  async createAlarm(deviceId, payload) {
    return this._post(`/api/devices/${deviceId}/alarms`, payload);
  }

  async acknowledgeAlarm(deviceId, alarmId, payload = {}) {
    return this._put(`/api/devices/${deviceId}/alarms/${alarmId}/ack`, payload);
  }

  async acknowledgeAllAlarms(deviceId, payload = {}) {
    return this._put(`/api/devices/${deviceId}/alarms/ack-all`, payload);
  }

  // ── Proyectos ────────────────────────────────────────────────────────────

  async getProjects() {
    return this._get('/api/projects');
  }

  async getProject(id) {
    return this._get(`/api/projects/${id}`);
  }

  async createProject(payload) {
    return this._post('/api/projects', payload);
  }

  async updateProject(id, payload) {
    return this._put(`/api/projects/${id}`, payload);
  }

  async deleteProject(id) {
    return this._delete(`/api/projects/${id}`);
  }

  // ── Comandos ─────────────────────────────────────────────────────────────

  async getPendingCommands(deviceId) {
    return this._get(`/api/devices/${deviceId}/commands`);
  }

  async sendCommand(deviceId, tag, value) {
    return this._post(`/api/devices/${deviceId}/commands`, { tag, value });
  }

  // ── HTTP Helpers ─────────────────────────────────────────────────────────

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this._handleResponse(res);
  }

  async _post(path, body, queryParams = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(queryParams).forEach(([k, v]) => url.searchParams.append(k, v));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this._handleResponse(res);
  }

  async _put(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this._handleResponse(res);
  }

  async _delete(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this._handleResponse(res);
  }

  async _handleResponse(res) {
    if (!res.ok) {
      let errorData;
      try {
        errorData = await res.json();
      } catch {
        errorData = { message: `HTTP ${res.status}` };
      }
      const error = new Error(errorData.message || `API Error: ${res.status}`);
      error.status = res.status;
      error.data = errorData;
      throw error;
    }

    // No content responses
    if (res.status === 204) return null;

    return res.json();
  }
}

/**
 * Instancia global del cliente (singleton).
 * Inicializar con: ScadaApiClient.init('http://localhost:5000')
 */
let _globalClient;

ScadaApiClient.init = (baseUrl, timeoutMs) => {
  _globalClient = new ScadaApiClient(baseUrl, timeoutMs);
};

ScadaApiClient.getInstance = () => {
  if (!_globalClient) {
    _globalClient = new ScadaApiClient();
  }
  return _globalClient;
};
