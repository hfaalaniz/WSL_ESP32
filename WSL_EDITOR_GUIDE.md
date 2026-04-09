# Editor WSL Avanzado - Documentación

## Overview

El **WslScriptEditor** es un editor profesional para scripts WSL (WSL Scripting Language) integrado en la **Fase 4** del flujo SCADA. Ofrece validación sintáctica en tiempo real, autocompletado inteligente, debugging integrado y ejecución interactiva.

## Características

### 1. **Validación Sintáctica en Tiempo Real** ✓
- Valida la sintaxis mientras escribes
- Muestra errores y warnings en tiempo real
- Integración con gutter de líneas para visualizar problemas
- Distintivos de validación en la UI:
  - ❌ **Error** - Código inválido que previene ejecución
  - ⚠️ **Warning** - Posibles problemas semánticos
  - ✓ **Válido** - Código correcto y listo para ejecutar

### 2. **Autocompletado Inteligente** ✓
- **Keywords**: ON, IF, WHILE, FOR, END, etc.
- **Built-in Functions**: SET, READ, LOG, NOTIFY, WAIT, etc.
- **Tags de Hardware**: Acceso automático a los tags definidos en Fase 2
- **Snippets**: Plantillas para estructuras comunes:
  - `ON INTERVAL` - Bloques periódicos
  - `ON CHANGE` - Reacción a cambios de estado
- **Trigger Characters**: 
  - `"` - Completa tags entre comillas
  - `(` - Completa parámetros de funciones
  - `.` - Acceso a miembros

### 3. **Debugging Integrado** 🐛
- **Toggle Debug**: Botón para activar/desactivar panel de debugging
- **Inspector de Variables**: Visualiza el estado de variables durante ejecución
- **Console Output**: Captura logs, alarmas y mensajes
- **Colores de mensajes**:
  - 📊 Blanco - LOG normales
  - ⚠️ Naranja - ALARM
  - ❌ Rojo - Errores de ejecución

### 4. **Editor Monaco Mejorado** 📝
- **Tema oscuro** especializado para WSL
- **Monospace font** (Fira Code) para mejor legibilidad
- **Line numbers** con sincronización de errores
- **Minimap** para navegación rápida
- **Auto-formatting** en paste y tipo
- **Bracket pair colorization**
- **Word wrap** para mejor experiencia en pantallas pequeñas

### 5. **Ejecución de Scripts** ▶️
- **Botón Ejecutar** (disponible solo si el código es válido)
- **Botón Detener** (visible durante ejecución)
- **Integración con WslRuntime** para ejecución real
- **Callbacks** para logs, alarmas y cambios de estado

## Estructura del Código

```
        ┌─────────────────────────┐
        │   Toolbar               │
        │ ┌──────────────────────┐│
        │ │ Validación | Botones ││
        │ └──────────────────────┘│
        └────────────┬────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    ┌───┴────────┐        ┌──────┴─────┐
    │   Editor   │        │Debug Panel │ (si DEBUG ON)
    │  (Monaco)  │        │ Variables  │
    │            │        │ Console    │
    └────────────┘        └────────────┘
```

## Uso

### Básico: Crear un Script Simple

```wsl
// Ejecutar cada 5 segundos
ON INTERVAL 5s
  SET "temperatura" 25.5
  LOG "Temp actualizada"
END

// Reaccionar a cambios
ON CHANGE "estado"
  IF "estado" THEN
    SET "alarma" TRUE
  ELSE
    SET "alarma" FALSE
  END
END
```

### Con Autocompletado

1. Presiona `Ctrl+Space` para abrir autocompletado
2. Escribe `ON INT` → autocompleta `ON INTERVAL`
3. Escribe `"` → muestra todos los tags disponibles
4. Selecciona con Enter o Tab

### Debugging

1. Haz click en el botón 🐛 **Debug** para activar
2. En el panel derecho verás:
   - **Variables**: Estado actual de variables
   - **Console**: Salida de logs y alarmas
3. Ejecuta con ▶️ **Ejecutar**
4. Observa cómo cambian las variables en tiempo real

## API del Componente

```jsx
<WslScriptEditor
  script={string}           // Código WSL inicial
  onChange={fn}             // Callback: (code) => void
  tags={string[]}           // Lista de tags del hardware
  hardware={object}         // Config hardware (opcional)
  onExecute={fn}            // Callback: (logs) => void
  onDebugStep={fn}          // Callback: (state) => void (futuro)
/>
```

## Clase WslValidator

Valida sintaxis y semántica de scripts WSL:

```javascript
const validator = new WslValidator(code);
const { ast, errors, warnings } = validator.validate();

if (errors.length > 0) {
  errors.forEach(e => {
    console.log(`Línea ${e.line}: ${e.message}`);
  });
}
```

## Integraciones

### WslParser (Análisis)
```javascript
const ast = new WslParser(code).parse();
// Produce AST para validación
```

### WslRuntime (Ejecución)
```javascript
const runtime = new WslRuntime({ hardware, script });
runtime.onLog = ({ ts, msg }) => console.log(msg);
await runtime.start();
```

## Ejemplos de Scripts

### Ejemplo 1: Control de Temperatura
```wsl
// Monitoreo de temperatura con alarma
ON INTERVAL 10s
  READ "temp_sensor"
  IF "temp_sensor" > 30 THEN
    SET "cooling_fan" TRUE
    ALARM "Temperatura alta" CRITICAL
  ELSE
    SET "cooling_fan" FALSE
  END
END
```

### Ejemplo 2: Secuencia de Control
```wsl
ON CLICK "start_button"
  SET "pump1" TRUE
  WAIT 2s
  SET "pump2" TRUE
  LOG "Bombas activadas"
END

ON CLICK "stop_button"
  SET "pump1" FALSE
  SET "pump2" FALSE
  LOG "Bombas desactivadas"
END
```

### Ejemplo 3: Lógica Compleja
```wsl
ON CHANGE "system_mode"
  IF "system_mode" = "AUTO" THEN
    ON INTERVAL 5s
      READ "sensors"
      IF "sensors" > "threshold" THEN
        SET "output" TRUE
      END
    END
  ELSE
    SET "output" FALSE
  END
END
```

## Teclas de Acceso Rápido

| Tecla | Acción |
|-------|--------|
| `Ctrl+Space` | Abrir autocompletado |
| `Ctrl+/` | Comentar línea |
| `Ctrl+Shift+F` | Formatear |
| `F11` | Pantalla completa editor |
| `Ctrl+Enter` | Ejecutar script |

## Notas de Implementación

- **WslValidator**: Realiza validación con WslParser
- **Monaco Integration**: Editor basado en Monaco Editor v0.48+
- **Real-time Feedback**: Validación y diagnostics en tiempo real
- **Execution Context**: WslRuntime proporciona sandbox seguro
- **Performance**: Debounce en validación (300ms) para evitar lag

## Mejoras Futuras

- [ ] Breakpoints con stepping
- [ ] Watch expressions
- [ ] Execution history
- [ ] Snippet library expandible
- [ ] Export/Import de scripts
- [ ] Integración con DevTools (F12)
- [ ] Profiling de performance
- [ ] Autocomplete basado en contexto semántico

## Troubleshooting

**P: El code no valida aunque parece correcto**
- R: Revisa las comillas alrededor de string literals (`"tag"`)
- R: Asegúrate de cerrar todos los bloques con `END`

**P: El autocompletado no muestra mis tags**
- R: Verifica que los tags se pasen correctamente en el prop `tags={}`
- R: Los tags deben estar entre comillas en el editor: `"tag_name"`

**P: Los cambios no se guardan**
- R: Usa el callback `onChange` para sincronizar con tu estado
- R: Comprueba que la prop `script` esté sincronizada

---

**Editor WSL v1.0.0** - Parte de WSL_ESP32 SCADA Framework
