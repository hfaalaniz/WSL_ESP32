/**
 * hardwareValidator.js
 * Validadores Zod para esquema [HARDWARE] del archivo .scada
 * 
 * Uso:
 *   import { HardwareSchema } from './hardwareValidator.js';
 *   
 *   try {
 *     const validated = HardwareSchema.parse(hardwareObject);
 *   } catch (e) {
 *     console.error('Validation error:', e.errors);
 *   }
 */

import { z } from 'zod';

/**  Validadores básicos */
const DeviceSchema = z.object({
  id: z.string()
    .min(1, 'Device ID es requerido')
    .max(64, 'Device ID máximo 64 caracteres')
    .regex(/^[a-z0-9_-]+$/, 'Solo minúsculas, números, guiones'),
  
  name: z.string()
    .min(1, 'Nombre requerido')
    .max(100, 'Nombre máximo 100 caracteres'),
  
  description: z.string().default(''),
  
  mode: z.enum(['LOCAL', 'REMOTE', 'AUTO']).default('AUTO'),
  
  connection: z.object({
    local: z.object({
      port: z.string().min(1),
      baud: z.number().int().positive()
    }),
    remote: z.object({
      ip: z.string().ip().optional(),
      port: z.number().int().min(1).max(65535).default(80),
      timeout_ms: z.number().int().positive().default(3000)
    })
  })
});

const NativePinSchema = z.object({
  gpio: z.number().int().min(0).max(39),
  label: z.string().optional()
});

const NativeSchema = z.object({
  digital_in: z.array(NativePinSchema).default([]),
  digital_out: z.array(
    NativePinSchema.extend({ default: z.boolean().default(false) }).default({})
  ).default([]),
  analog_in: z.array(NativePinSchema).default([]),
  pwm_out: z.array(NativePinSchema).default([])
});

const IC595Schema = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(0).max(8).default(0),
  pins: z.object({
    data: z.number().int().optional(),
    clock: z.number().int().optional(),
    latch: z.number().int().optional()
  }),
  outputs: z.array(z.object({
    index: z.number().int(),
    label: z.string().optional()
  })).default([])
});

const IC165Schema = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(0).max(8).default(0),
  pins: z.object({
    data: z.number().int().optional(),
    clock: z.number().int().optional(),
    load: z.number().int().optional()
  }),
  inputs: z.array(z.object({
    index: z.number().int(),
    label: z.string().optional()
  })).default([])
});

const ADSChannelSchema = z.object({
  ch: z.number().int().min(0).max(3),
  label: z.string().optional()
});

const ADS1115Schema = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(0).max(4).default(0),
  pins: z.object({
    sda: z.number().int().optional(),
    scl: z.number().int().optional()
  }),
  devices: z.array(z.object({
    address: z.enum(['0x48', '0x49', '0x4A', '0x4B']),
    channels: z.array(ADSChannelSchema).default([])
  })).default([])
});

const MCP23017Schema = z.object({
  enabled: z.boolean().default(false),
  count: z.number().int().min(0).max(8).default(0),
  pins: z.object({
    sda: z.number().int().optional(),
    scl: z.number().int().optional()
  }),
  devices: z.array(z.object({
    address: z.enum(['0x20', '0x21', '0x22', '0x23', '0x24', '0x25', '0x26', '0x27']),
    portA: z.array(z.number().int().min(0).max(255)).default([]),
    portB: z.array(z.number().int().min(0).max(255)).default([])
  })).default([])
});

const ExpansionSchema = z.object({
  ic595: IC595Schema,
  ic165: IC165Schema,
  ads1115: ADS1115Schema,
  mcp23017: MCP23017Schema
});

/**
 * Schema principal: [HARDWARE]
 */
export const HardwareSchema = z.object({
  device: DeviceSchema,
  native: NativeSchema,
  expansion: ExpansionSchema
});

/**
 * Schema del archivo .scada completo
 */
export const ScadaFileSchema = z.object({
  version: z.literal('##SCADA_FILE_V1'),
  created: z.string().datetime().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  
  hardware: HardwareSchema,
  design: z.object({}).passthrough().default({}),  // JSON libre
  script: z.string().default('')                   // Código WSL
});

/**
 * Validador para la sección [SCRIPT]
 */
export const ScriptSchema = z.string()
  .min(0)
  .max(100000, 'Script máximo 100KB');

/**
 * Validador para la sección [DESIGN]
 */
export const DesignSchema = z.object({
  screens: z.array(z.object({
    id: z.string(),
    name: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    objects: z.array(z.object({}).passthrough()).default([])
  })).default([])
});

// Exportar tipos inferred de Zod
export type Hardware = z.infer<typeof HardwareSchema>;
export type ScadaFile = z.infer<typeof ScadaFileSchema>;
export type Design = z.infer<typeof DesignSchema>;
