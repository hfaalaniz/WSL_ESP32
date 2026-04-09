/**
 * tagGenerator.js
 * Generador centralizado de tags SCADA desde configuración [HARDWARE].
 *
 * Proporciona múltiples formatos:
 * - generateTagsSimple(hw)      → Array<string>
 * - generateTagsWithMetadata(hw) → Array<{tag, type, dir, label}>
 * - buildTagsMap(hw)            → Map<string, value>
 */

/**
 * Genera tags simples (solo nombres).
 * Retorna: ["device.din.gpio4", "device.dout.gpio2", ...]
 */
export function generateTagsSimple(hw) {
  if (!hw) return [];
  const id = hw.device?.id || 'device';
  const nat = hw.native || {};
  const exp = hw.expansion || {};
  const tags = [];

  // I/O nativa
  (nat.digital_in || []).forEach(p => tags.push(`${id}.din.gpio${p.gpio}`));
  (nat.digital_out || []).forEach(p => tags.push(`${id}.dout.gpio${p.gpio}`));
  (nat.analog_in || []).forEach(p => tags.push(`${id}.ain.adc${p.gpio}`));
  (nat.pwm_out || []).forEach(p => tags.push(`${id}.pwm.gpio${p.gpio}`));

  // 74HC595 (salidas)
  const e595 = exp.ic595;
  if (e595?.enabled && e595.count > 0) {
    Array.from({ length: e595.count * 8 }, (_, i) => tags.push(`${id}.595.out.${i}`));
  }

  // 74HC165 (entradas)
  const e165 = exp.ic165;
  if (e165?.enabled && e165.count > 0) {
    Array.from({ length: e165.count * 8 }, (_, i) => tags.push(`${id}.165.in.${i}`));
  }

  // ADS1115 (analógicas)
  (exp.ads1115?.devices || []).forEach((dev, di) =>
    (dev.channels || []).forEach(ch => tags.push(`${id}.ads.${di}.ch${ch.ch}`))
  );

  // MCP23017 (digitales I2C)
  (exp.mcp23017?.devices || []).forEach((_, di) => {
    for (let i = 0; i < 8; i++) tags.push(`${id}.mcp.${di}.a${i}`);
    for (let i = 0; i < 8; i++) tags.push(`${id}.mcp.${di}.b${i}`);
  });

  return tags;
}

/**
 * Genera tags con metadata completa (tipo, dirección, label).
 * Retorna: [
 *   { tag: "device.din.gpio4", type: "boolean", dir: "IN", label: "..." },
 *   ...
 * ]
 */
export function generateTagsWithMetadata(hw) {
  if (!hw) return [];
  const id = hw.device?.id || 'device';
  const nat = hw.native || {};
  const exp = hw.expansion || {};
  const tags = [];

  // I/O nativa
  (nat.digital_in || []).forEach(p =>
    tags.push({
      tag: `${id}.din.gpio${p.gpio}`,
      type: 'boolean',
      dir: 'IN',
      label: p.label || `DIN GPIO${p.gpio}`
    })
  );

  (nat.digital_out || []).forEach(p =>
    tags.push({
      tag: `${id}.dout.gpio${p.gpio}`,
      type: 'boolean',
      dir: 'OUT',
      label: p.label || `DOUT GPIO${p.gpio}`
    })
  );

  (nat.analog_in || []).forEach(p =>
    tags.push({
      tag: `${id}.ain.adc${p.gpio}`,
      type: 'float',
      dir: 'IN',
      label: p.label || `AIN ADC${p.gpio}`
    })
  );

  (nat.pwm_out || []).forEach(p =>
    tags.push({
      tag: `${id}.pwm.gpio${p.gpio}`,
      type: 'integer',
      dir: 'OUT',
      label: p.label || `PWM GPIO${p.gpio}`
    })
  );

  // 74HC595 (salidas)
  if (exp.ic595?.enabled) {
    const total = exp.ic595.count * 8;
    for (let i = 0; i < total; i++) {
      tags.push({
        tag: `${id}.595.out.${i}`,
        type: 'boolean',
        dir: 'OUT',
        label: exp.ic595.outputs?.[i]?.label || `595 OUT ${i}`
      });
    }
  }

  // 74HC165 (entradas)
  if (exp.ic165?.enabled) {
    const total = exp.ic165.count * 8;
    for (let i = 0; i < total; i++) {
      tags.push({
        tag: `${id}.165.in.${i}`,
        type: 'boolean',
        dir: 'IN',
        label: exp.ic165.inputs?.[i]?.label || `165 IN ${i}`
      });
    }
  }

  // ADS1115 (analógicas)
  (exp.ads1115?.devices || []).forEach((d, di) =>
    (d.channels || []).forEach(ch =>
      tags.push({
        tag: `${id}.ads.${di}.ch${ch.ch}`,
        type: 'float',
        dir: 'IN',
        label: ch.label || `ADS${di} CH${ch.ch}`
      })
    )
  );

  // MCP23017 (digitales I2C)
  (exp.mcp23017?.devices || []).forEach((_, di) => {
    for (let i = 0; i < 8; i++) {
      tags.push({
        tag: `${id}.mcp.${di}.a${i}`,
        type: 'boolean',
        dir: 'IO',
        label: `MCP${di} A${i}`
      });
      tags.push({
        tag: `${id}.mcp.${di}.b${i}`,
        type: 'boolean',
        dir: 'IO',
        label: `MCP${di} B${i}`
      });
    }
  });

  return tags;
}

/**
 * Genera un Map de tags (tag → valor inicial).
 * Compatible con la clase TagManager.
 * Retorna: Map<string, any>
 */
export function buildTagsMap(hw) {
  if (!hw) return new Map();
  const id = hw.device?.id || 'device';
  const nat = hw.native || {};
  const exp = hw.expansion || {};
  const map = new Map();

  // I/O nativa
  (nat.digital_in || []).forEach(p => map.set(`${id}.din.gpio${p.gpio}`, false));
  (nat.digital_out || []).forEach(p =>
    map.set(`${id}.dout.gpio${p.gpio}`, p.default ?? false)
  );
  (nat.analog_in || []).forEach(p => map.set(`${id}.ain.adc${p.gpio}`, 0));
  (nat.pwm_out || []).forEach(p => map.set(`${id}.pwm.gpio${p.gpio}`, 0));

  // 74HC595 (salidas)
  if (exp.ic595?.enabled && exp.ic595.count > 0) {
    const total = exp.ic595.count * 8;
    for (let i = 0; i < total; i++) {
      const meta = exp.ic595.outputs?.find(o => o.index === i);
      map.set(`${id}.595.out.${i}`, meta?.default ?? false);
    }
  }

  // 74HC165 (entradas)
  if (exp.ic165?.enabled && exp.ic165.count > 0) {
    const total = exp.ic165.count * 8;
    for (let i = 0; i < total; i++) {
      map.set(`${id}.165.in.${i}`, false);
    }
  }

  // ADS1115 (analógicas)
  (exp.ads1115?.devices || []).forEach((dev, di) => {
    (dev.channels || []).forEach(ch => {
      map.set(`${id}.ads.${di}.ch${ch.ch}`, 0);
    });
  });

  // MCP23017 (digitales I2C)
  (exp.mcp23017?.devices || []).forEach((_, di) => {
    for (let i = 0; i < 8; i++) map.set(`${id}.mcp.${di}.a${i}`, false);
    for (let i = 0; i < 8; i++) map.set(`${id}.mcp.${di}.b${i}`, false);
  });

  return map;
}

/**
 * Alias: generateTags es un alias de generateTagsSimple para compatibilidad.
 */
export const generateTags = generateTagsSimple;
