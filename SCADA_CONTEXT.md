# WSL SCADA — Contexto del Proyecto

## Descripción
Sistema SCADA completo basado en ESP32 con:
- Editor visual canvas (drag & drop)
- Lenguaje de scripting propio (WSL)
- Archivo de proyecto `.scada` con 3 secciones
- Soporte de expansión de I/O con ICs (74HC595, 74HC165, ADS1115, MCP23017)
- Comunicación HTTP REST (sin MQTT)
- Modos LOCAL (Serial) y REMOTE (WiFi)

## Stack tecnológico
- **Frontend:** React + Konva.js (canvas) + Monaco Editor (script)
- **Backend:** C# ASP.NET Core + PostgreSQL
- **Firmware:** ESP32 Arduino C++
- **Protocolo:** HTTP REST JSON
- **Estado global:** Zustand
- **Gráficos:** Recharts
- **Estilos:** Tailwind CSS

## Formato archivo `.scada`
```
##SCADA_FILE_V1
##CREATED: <ISO date>
##AUTHOR: <nombre>
##DESCRIPTION: <descripcion>

[HARDWARE]   → JSON config dispositivo + expansiones
[DESIGN]     → JSON canvas (pantallas, objetos, bindings)
[SCRIPT]     → Código WSL (lógica, eventos, automatización)
```

## Tag Naming Convention
```
{device_id}.din.gpio{N}        → Digital IN nativa
{device_id}.dout.gpio{N}       → Digital OUT nativa
{device_id}.ain.adc{N}         → Analog IN nativa
{device_id}.pwm.gpio{N}        → PWM OUT nativa
{device_id}.595.out.{index}    → 74HC595 salida digital
{device_id}.165.in.{index}     → 74HC165 entrada digital
{device_id}.ads.{ic}.ch{N}     → ADS1115 entrada analógica
{device_id}.mcp.{ic}.a{N}      → MCP23017 puerto A
{device_id}.mcp.{ic}.b{N}      → MCP23017 puerto B
```

## Sintaxis WSL
```
// Eventos disponibles
ON STARTUP          → al iniciar el runtime
ON INTERVAL <time>  → cada N segundos/minutos
ON CHANGE "<tag>"   → cuando cambia un valor
ON CLICK "<obj-id>" → interacción del operador
ON ALARM "<tag>"    → cuando se dispara alarma
ON SHUTDOWN         → al cerrar

// Comandos
READ("tag")                   → lee valor de tag
SET("tag", valor)             → escribe valor
ALARM("mensaje", nivel)       → genera alarma [INFO|WARN|CRITICAL]
LOG("mensaje")                → escribe en log
NOTIFY("mensaje")             → notificación en HMI
CALL("endpoint", payload)     → HTTP request custom
WAIT(ms)                      → pausa
MODE()                        → retorna LOCAL | REMOTE
DEVICE()                      → retorna IP o puerto

// Control de flujo
IF / THEN / ELSE / END
WHILE / DO / END
FOR x FROM 1 TO N / END

// Tipos
numero   = 0
booleano = TRUE
texto    = "string"
tiempo   = NOW()
```

## ICs de expansión soportados
| IC        | Función                  | Interfaz | Máx ICs | Canales/IC |
|-----------|--------------------------|----------|---------|------------|
| 74HC595   | Salidas digitales        | SPI      | 8       | 8          |
| 74HC165   | Entradas digitales       | SPI      | 8       | 8          |
| ADS1115   | Entradas analógicas 16b  | I2C      | 4       | 4          |
| MCP23017  | I/O digitales            | I2C      | 8       | 16         |

## HTTP Endpoints (ESP32)
```
GET  /api/telemetry       → todos los tags como JSON
POST /api/command         → { "tag": "...", "value": ... }
GET  /api/ping            → estado del dispositivo
```

## Plan de fases
| Fase | Descripción              | Estado     | Archivo                    |
|------|--------------------------|------------|----------------------------|
| F1   | Schema .scada            | ✅ Completa | (documentada)              |
| F2   | Config Hardware React    | ✅ Completa | HardwareConfigurator.jsx   |
| F3   | Generador Firmware ESP32 | ✅ Completa | FirmwareGenerator.jsx      |
| F4   | Parser WSL               | ✅ Completa | WslParser.js + WslLexer.js |
| F5   | Editor Canvas + Script   | ✅ Completa | ScadaEditor.jsx            |
| F6   | Runtime Engine           | ✅ Completa | TagManager.js + Transport.js + WslRuntime.js |
| F7   | API C# Backend           | ✅ Completa | ScadaApi/ (ASP.NET Core 8) |

## Estructura de carpetas sugerida
```
/scada-project
  /frontend
    /src
      /components
        HardwareConfigurator.jsx   ← F2
        FirmwareGenerator.jsx      ← F3
        ScadaEditor.jsx            ← F5 (canvas + script)
      /engine
        WslParser.js               ← F4
        WslRuntime.js              ← F6
        TagManager.js              ← generado desde [HARDWARE]
        Transport.js               ← LOCAL (Serial) / REMOTE (HTTP)
      /store
        useScadaStore.js           ← Zustand
  /backend
    /ScadaApi                      ← ASP.NET Core C#
      /Controllers
      /Models
      /Data
  /firmware
    equipo-01.ino                  ← generado por F3
  SCADA_CONTEXT.md                 ← este archivo
```

## Notas importantes
- GPIO 1 y 3 son reservados (UART0), nunca asignar
- GPIO 34, 35, 36, 39 son solo entrada (input only)
- 595 y 165 pueden compartir pines CLOCK y DATA si están en el mismo bus SPI
- ADS1115 y MCP23017 comparten bus I2C (SDA/SCL)
- El runtime WSL interpreta el AST generado por el parser, nunca el texto crudo
- Modo AUTO detecta: RED disponible → REMOTE, Serial activo → LOCAL, ambos → REMOTE preferido
