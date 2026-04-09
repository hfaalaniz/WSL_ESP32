/**
 * TagManager.js
 * Store reactivo de tags SCADA.
 *
 * Responsabilidades:
 *  - Mantener el valor actual de cada tag
 *  - Notificar suscriptores cuando cambia un valor
 *  - Inicializar el mapa de tags desde la config [HARDWARE]
 *
 * NO conoce alarmas ni transporte — eso es responsabilidad del Runtime.
 */

import { buildTagsMap } from '../utils/tagGenerator.js';

// ─── TagManager ──────────────────────────────────────────────────────────────

export class TagManager {
  /**
   * @param {object} hardware  — sección [HARDWARE] del .scada
   */
  constructor(hardware) {
    /** @type {Map<string, any>} tag → valor actual */
    this._values    = buildTagsMap(hardware);

    /** @type {Map<string, Set<Function>>} tag → listeners de cambio */
    this._listeners = new Map();

    /** Tags conocidos (extras se pueden agregar dinámicamente) */
    this._known = new Set(this._values.keys());
  }

  // ── Lectura / escritura ────────────────────────────────────────────────────

  /**
   * Lee el valor actual de un tag.
   * Retorna null si el tag no existe.
   */
  getValue(tag) {
    return this._values.has(tag) ? this._values.get(tag) : null;
  }

  /**
   * Escribe un nuevo valor. Dispara listeners solo si el valor cambió.
   */
  setValue(tag, value) {
    const prev = this._values.get(tag);
    this._values.set(tag, value);
    this._known.add(tag);

    if (prev !== value) {
      this._fire(tag, value, prev);
    }
  }

  /**
   * Aplica un objeto plano { tag: value, ... } de una respuesta de telemetría.
   */
  applyTelemetry(data) {
    for (const [tag, value] of Object.entries(data)) {
      this.setValue(tag, value);
    }
  }

  /**
   * Retorna todos los valores como objeto plano.
   */
  snapshot() {
    return Object.fromEntries(this._values);
  }

  /**
   * Lista de todos los tags conocidos.
   */
  getTags() {
    return Array.from(this._known);
  }

  // ── Suscripciones ──────────────────────────────────────────────────────────

  /**
   * Registra un callback para cuando cambie el valor de un tag específico.
   * @returns {Function} función para cancelar la suscripción
   */
  onChange(tag, callback) {
    if (!this._listeners.has(tag)) this._listeners.set(tag, new Set());
    this._listeners.get(tag).add(callback);
    return () => this._listeners.get(tag)?.delete(callback);
  }

  /**
   * Cancela todos los listeners de un tag.
   */
  offAll(tag) {
    this._listeners.delete(tag);
  }

  /**
   * Cancela todos los listeners de todos los tags.
   */
  clear() {
    this._listeners.clear();
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  _fire(tag, value, prev) {
    const listeners = this._listeners.get(tag);
    if (!listeners) return;
    for (const cb of listeners) {
      try { cb(value, prev, tag); }
      catch (e) { console.error(`[TagManager] Listener error en ${tag}:`, e); }
    }
  }
}
