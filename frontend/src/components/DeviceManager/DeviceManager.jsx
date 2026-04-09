/**
 * DeviceManager.jsx — F6: Gestión de dispositivo ESP32
 *
 * Secciones:
 *   1. Selector de placa (catálogo + detección por Web Serial)
 *   2. Estado de conexión (WiFi / Serial / Sin conexión)
 *   3. Flash de firmware (.bin) al ESP32 vía esptool-js  ← requiere Web Serial
 *   4. Hot-reload de script WSL (POST /api/script o Serial JSON)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useScadaStore } from '../../store/scadaStore.js';
import { WslParser } from '../../engine/WslParser.js';

// ─── Catálogo de placas ───────────────────────────────────────────────────────

const BOARD_CATALOG = [
  {
    id: 'esp32-devkit-38pin',
    name: 'ESP32 DevKit 38-pin',
    chip: 'ESP32-WROOM-32',
    vendor: 'Genérico / AI-Thinker',
    usbChip: 'CP2102',
    flash: '4MB', ram: '520KB',
    gpios: 38, uart: true, wifi: true, ble: true,
    pinout: {
      left:  ['3V3','EN','SP','SM','G34','G35','G32','G33','G25','G26','G27','G14','G12','GND','G13','SD2','SD3','CMD','V5'],
      right: ['GND','G23','G22','TXD','RXD','G21','GND','G19','G18','G5','G17','G16','G4','G3','G2','G15','SD1','SD0','CLK'],
    },
    inputOnly: ['G34','G35'],
    sdPins: ['SD0','SD1','SD2','SD3','CMD','CLK'],
    description: 'DevKit de 38 pines con módulo WROOM-32 y conversor USB-Serial CP2102. Expone pines SD (Flash interno) en las columnas exteriores. Los pines SD0–SD3/CMD/CLK deben usarse con precaución.',
    img: '🟦',
    // Huellas de detección automática (strings del bootrom)
    autoDetectHints: ['ESP32', 'WROOM', 'CP2102', 'rst:0x1'],
  },
  {
    id: 'esp32-devkit-v1',
    name: 'ESP32 DevKit V1 (30-pin)',
    chip: 'ESP32-WROOM-32',
    vendor: 'Espressif / Genérico',
    usbChip: 'CP2102 / CH340',
    flash: '4MB', ram: '520KB',
    gpios: 30, uart: true, wifi: true, ble: true,
    pinout: {
      left:  ['3V3','EN','G36','G39','G34','G35','G32','G33','G25','G26','G27','G14','G12','GND','G13','G9','G10','G11','V5'],
      right: ['GND','G23','G22','TXD','RXD','G21','GND','G19','G18','G5','G17','G16','G4','G0','G2','G15','G8','G7','G6'],
    },
    inputOnly: ['G36','G39','G34','G35'],
    description: 'Placa de desarrollo más común. 30 pines, compatible con la mayoría de shields y proyectos.',
    img: '🟦',
    autoDetectHints: ['ESP32', 'WROOM', 'rst:0x1'],
  },
  {
    id: 'esp32-wroom-da',
    name: 'ESP32-WROOM-DA (antena dual)',
    chip: 'ESP32-WROOM-DA',
    vendor: 'Espressif',
    usbChip: 'CP2102 / CH340',
    flash: '4MB', ram: '520KB',
    gpios: 38, uart: true, wifi: true, ble: true,
    pinout: {
      left:  ['3V3','EN','SP','SM','G34','G35','G32','G33','G25','G26','G27','G14','G12','GND','G13','SD2','SD3','CMD','V5'],
      right: ['GND','G23','G22','TXD','RXD','G21','GND','G19','G18','G5','G17','G16','G4','G3','G2','G15','SD1','SD0','CLK'],
    },
    inputOnly: ['G34','G35'],
    reservedPins: ['G21','G22'],
    sdPins: ['SD0','SD1','SD2','SD3','CMD','CLK'],
    description: 'Variante WROOM con antena PCB dual para mejor cobertura WiFi/BT. GPIO21 y GPIO22 están reservados internamente para la selección de antena — no usar como GPIO general.',
    img: '📡',
    autoDetectHints: ['ESP32', 'WROOM-DA'],
  },
  {
    id: 'esp32-wroom-32u',
    name: 'ESP32-WROOM-32U',
    chip: 'ESP32-WROOM-32U',
    vendor: 'Espressif',
    usbChip: '—',
    flash: '4MB', ram: '520KB',
    gpios: 25, uart: true, wifi: true, ble: true,
    description: 'Igual que WROOM-32 pero con conector U.FL para antena externa.',
    img: '🟦',
    autoDetectHints: ['ESP32', 'WROOM-32U'],
  },
  {
    id: 'esp32-s3-devkit',
    name: 'ESP32-S3 DevKit',
    chip: 'ESP32-S3',
    vendor: 'Espressif',
    usbChip: 'USB nativo',
    flash: '8MB', ram: '512KB + 2MB PSRAM',
    gpios: 36, uart: true, wifi: true, ble: true,
    description: 'Mayor rendimiento, USB nativo, soporte AI/ML. Xtensa LX7 dual-core.',
    img: '🟩',
    autoDetectHints: ['ESP32-S3', 'S3'],
  },
  {
    id: 'esp32-s2-mini',
    name: 'ESP32-S2 Mini',
    chip: 'ESP32-S2',
    vendor: 'WEMOS / Lolin',
    usbChip: 'USB nativo',
    flash: '4MB', ram: '320KB',
    gpios: 27, uart: true, wifi: true, ble: false,
    description: 'Single-core, USB nativo, sin BLE. Compacto.',
    img: '🟩',
    autoDetectHints: ['ESP32-S2', 'S2'],
  },
  {
    id: 'esp32-c3-mini',
    name: 'ESP32-C3 Mini',
    chip: 'ESP32-C3',
    vendor: 'Espressif / WEMOS',
    usbChip: 'USB nativo',
    flash: '4MB', ram: '400KB',
    gpios: 15, uart: true, wifi: true, ble: true,
    description: 'RISC-V single-core, USB nativo, bajo consumo.',
    img: '🟨',
    autoDetectHints: ['ESP32-C3', 'C3'],
  },
  {
    id: 'nodemcu-32s',
    name: 'NodeMCU-32S',
    chip: 'ESP32',
    vendor: 'AI-Thinker',
    usbChip: 'CP2102',
    flash: '4MB', ram: '520KB',
    gpios: 30, uart: true, wifi: true, ble: true,
    description: 'Compatible con DevKit V1. Muy popular en proyectos IoT y educación.',
    img: '🟦',
    autoDetectHints: ['ESP32', 'NodeMCU', 'CP2102'],
  },
  {
    id: 'lolin32',
    name: 'LOLIN32 / WEMOS D32',
    chip: 'ESP32',
    vendor: 'WEMOS',
    usbChip: 'CH340',
    flash: '4MB', ram: '520KB',
    gpios: 26, uart: true, wifi: true, ble: true,
    description: 'Conector batería LiPo integrado. Cargador TP4054.',
    img: '🟪',
    autoDetectHints: ['ESP32', 'WEMOS', 'D32'],
  },
  {
    id: 'esp32-cam',
    name: 'ESP32-CAM',
    chip: 'ESP32',
    vendor: 'AI-Thinker',
    usbChip: '— (requiere adaptador)',
    flash: '4MB', ram: '520KB + PSRAM',
    gpios: 9, uart: true, wifi: true, ble: false,
    description: 'Incluye cámara OV2640. GPIOs muy limitados. Requiere adaptador FTDI para programar.',
    img: '📷',
    autoDetectHints: ['ESP32', 'CAM'],
  },
  {
    id: 'custom',
    name: 'Personalizada',
    chip: 'ESP32',
    vendor: '—',
    usbChip: '—',
    flash: '—', ram: '—',
    gpios: null, uart: true, wifi: true, ble: true,
    description: 'Definir manualmente las características del dispositivo.',
    img: '⚙',
    autoDetectHints: [],
  },
];

// ─── Reglas de detección automática ──────────────────────────────────────────
// El ESP32 al arrancar/resetear imprime en el UART0 (115200 bps) una cadena
// que contiene el tipo de chip, revisión, MAC, tamaño de flash, etc.
// Ejemplo real de bootrom ESP32:
//   rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
//   ets Jun  8 2016 00:22:57
//   ESP-IDF ...  chip:ESP32-D0WD-V3
//   Features: WiFi/BT
//   Crystal: 40MHz
//   mac: xx:xx:xx:xx:xx:xx
//   flash: 4MB

const AUTO_DETECT_RULES = [
  { pattern: /ESP32-S3/i,                       boardId: 'esp32-s3-devkit'   },
  { pattern: /ESP32-S2/i,                       boardId: 'esp32-s2-mini'     },
  { pattern: /ESP32-C3/i,                       boardId: 'esp32-c3-mini'     },
  { pattern: /WROOM-DA/i,                       boardId: 'esp32-wroom-da'    }, // antena dual — antes del genérico
  { pattern: /WROOM-32U/i,                      boardId: 'esp32-wroom-32u'   },
  { pattern: /ESP32-CAM|OV2640/i,               boardId: 'esp32-cam'         },
  { pattern: /NodeMCU/i,                        boardId: 'nodemcu-32s'       },
  { pattern: /D32|LOLIN/i,                      boardId: 'lolin32'           },
  // ESP32-D0WD-V3 es el chip del WROOM-32 de 38 pines (tiene pines SD expuestos)
  { pattern: /ESP32-D0WD-V3|ESP32-D0WDR2-V3/i,  boardId: 'esp32-devkit-38pin'},
  { pattern: /ESP32-D0WD/i,                     boardId: 'esp32-devkit-v1'   },
  { pattern: /ESP32/i,                          boardId: 'esp32-devkit-v1'   }, // fallback genérico
];

// Extrae datos estructurados del texto del bootrom
function parseBootromText(text) {
  const result = { chip: null, mac: null, flashSize: null, rev: null, features: null };
  const chipM    = text.match(/chip[:\s]+(ESP32[\w-]*)/i);
  const macM     = text.match(/mac[:\s]+([0-9a-f:]{17})/i);
  const flashM   = text.match(/flash[:\s]+(\d+\s*MB)/i);
  const revM     = text.match(/revision[:\s]+v?(\d+)/i);
  const featM    = text.match(/features[:\s]+(.+)/i);
  if (chipM)  result.chip     = chipM[1].toUpperCase();
  if (macM)   result.mac      = macM[1];
  if (flashM) result.flashSize= flashM[1];
  if (revM)   result.rev      = revM[1];
  if (featM)  result.features = featM[1].trim();
  return result;
}

// ─── Chip families para baudrate y flash ─────────────────────────────────────

const BAUD_OPTIONS = [115200, 230400, 460800, 921600];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function statusColor(s) {
  return s === 'ok' ? '#22c55e' : s === 'error' ? '#ef4444' : s === 'busy' ? '#f59e0b' : '#64748b';
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DeviceManager() {
  const { currentProject } = useScadaStore();
  const hw = currentProject.hardware;

  // Placa seleccionada
  const storedBoardId = hw?.device?.boardId || 'esp32-devkit-v1';
  const [boardId,     setBoardId]     = useState(storedBoardId);
  const [customBoard, setCustomBoard] = useState({ name: '', chip: 'ESP32', flash: '4MB', ram: '520KB' });

  // Conexión serial
  const [serialPort,   setSerialPort]   = useState(null);   // Web Serial port handle
  const [serialBaud,   setSerialBaud]   = useState(115200);
  const [serialStatus, setSerialStatus] = useState('idle');  // idle|connecting|connected|error
  const [serialLog,    setSerialLog]    = useState([]);

  // Detección automática
  const [detecting,    setDetecting]    = useState(false);
  const [detected,     setDetected]     = useState(null);    // { chip, mac, flashSize, rev, features }
  const [showPinout,   setShowPinout]   = useState(false);

  // Flash firmware
  const [fwFile,       setFwFile]       = useState(null);    // File object
  const [fwProgress,   setFwProgress]   = useState(0);
  const [fwStatus,     setFwStatus]     = useState('idle');  // idle|flashing|ok|error
  const [fwMsg,        setFwMsg]        = useState('');
  const [fwLogs,       setFwLogs]       = useState([]);      // logs de esptool en tiempo real
  const fwLogsEndRef = useRef(null);

  // Modal personalizado para ingresar puerto COM
  const [comModal, setComModal] = useState({ open: false, value: 'COM3', resolve: null });
  const comModalInputRef = useRef(null);

  // Abre el modal y retorna una Promise que resuelve con el valor ingresado (o null si cancela)
  const askComPort = useCallback(() => new Promise(resolve => {
    setComModal({ open: true, value: 'COM3', resolve });
  }), []);

  const comModalConfirm = () => {
    const val = comModal.value.trim();
    setComModal(m => ({ ...m, open: false }));
    comModal.resolve(val || null);
  };
  const comModalCancel = () => {
    setComModal(m => ({ ...m, open: false }));
    comModal.resolve(null);
  };

  // Foco automático en el input cuando se abre el modal
  useEffect(() => {
    if (comModal.open) setTimeout(() => comModalInputRef.current?.select(), 50);
  }, [comModal.open]);

  // Script upload
  const [scriptStatus, setScriptStatus] = useState('idle'); // idle|uploading|ok|error
  const [scriptMsg,    setScriptMsg]    = useState('');

  const fwInputRef  = useRef(null);
  const readerRef   = useRef(null);

  const board = BOARD_CATALOG.find(b => b.id === boardId) || BOARD_CATALOG[0];

  // ── Conexión Web Serial ───────────────────────────────────────────────────

  const hasSerial = !!navigator.serial;

  const addLog = useCallback((msg, type = 'info') => {
    setSerialLog(prev => [...prev.slice(-199), { ts: new Date(), msg, type }]);
  }, []);

  const connectSerial = useCallback(async () => {
    if (!hasSerial) { addLog('Web Serial no soportado en este navegador', 'error'); return; }
    setSerialStatus('connecting');
    try {
      const port = await navigator.serial.requestPort();

      // Si el puerto ya está abierto (p.ej. hot-reload), intentar cerrarlo primero
      try {
        readerRef.current?.cancel();
        readerRef.current = null;
        await port.close();
      } catch { /* ignorar — puede que no estuviera abierto */ }

      await port.open({ baudRate: serialBaud });
      setSerialPort(port);
      setSerialStatus('connected');
      addLog(`──── Puerto abierto a ${serialBaud} bps ────`, 'separator');
      addLog('Esperando datos del dispositivo...', 'info');

      // Leer stream de datos
      const reader = port.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(l => l.trim() && addLog(l.trim(), 'device'));
          }
        } catch { /* puerto cerrado */ }
      })();
    } catch (e) {
      if (e.name !== 'NotFoundError') addLog(`Error al conectar: ${e.message}`, 'error');
      setSerialStatus('idle');
    }
  }, [hasSerial, serialBaud, addLog]);

  const disconnectSerial = useCallback(async () => {
    try {
      readerRef.current?.cancel();
      readerRef.current = null;
      await serialPort?.close();
    } catch {}
    setSerialPort(null);
    setSerialStatus('idle');
    setDetected(null);
    addLog('Puerto cerrado', 'info');
  }, [serialPort, addLog]);

  useEffect(() => () => { readerRef.current?.cancel(); serialPort?.close().catch(() => {}); }, []);
  useEffect(() => { fwLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [fwLogs]);

  // ── Detección automática de placa ─────────────────────────────────────────
  // Estrategia: leer los primeros 5 segundos del UART tras un reset de software.
  // El bootrom del ESP32 imprime la identificación automáticamente al arrancar.

  const detectBoard = useCallback(async () => {
    if (!serialPort) { addLog('Conecta el puerto serial primero', 'error'); return; }
    setDetecting(true);
    setDetected(null);
    addLog('Leyendo bootrom — pulsa RST en la placa o espera un mensaje...', 'info');

    // Acumular texto entrante durante 5 segundos
    let accumulated = '';
    const TIMEOUT_MS = 5000;
    const deadline = Date.now() + TIMEOUT_MS;

    // Suspendemos el reader continuo y creamos uno temporal
    try {
      readerRef.current?.cancel();
    } catch {}

    try {
      const reader = serialPort.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();

      const readLoop = async () => {
        while (Date.now() < deadline) {
          const timeLeft = deadline - Date.now();
          const raceResult = await Promise.race([
            reader.read(),
            new Promise(res => setTimeout(() => res({ done: true, timeout: true }), timeLeft)),
          ]);
          if (raceResult.done) break;
          const chunk = decoder.decode(raceResult.value, { stream: true });
          accumulated += chunk;
          // Mostrar en log
          chunk.split('\n').forEach(l => l.trim() && addLog(l.trim(), 'device'));
          // Si ya tenemos suficiente info, salir antes
          if (/chip.*ESP32/i.test(accumulated) && /mac/i.test(accumulated)) break;
        }
        reader.releaseLock();
      };

      await readLoop();
    } catch (e) {
      addLog(`Error durante lectura: ${e.message}`, 'error');
    }

    // Reiniciar reader continuo
    try {
      const reader = serialPort.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(l => l.trim() && addLog(l.trim(), 'device'));
          }
        } catch {}
      })();
    } catch {}

    if (!accumulated.trim()) {
      addLog('Sin respuesta — pulsa el botón RST de la placa e intenta de nuevo', 'error');
      setDetecting(false);
      return;
    }

    // Parsear texto del bootrom
    const info = parseBootromText(accumulated);

    // Identificar placa
    let matchedId = null;
    for (const rule of AUTO_DETECT_RULES) {
      if (rule.pattern.test(accumulated)) { matchedId = rule.boardId; break; }
    }

    if (matchedId) {
      setBoardId(matchedId);
      addLog(`Placa detectada: ${BOARD_CATALOG.find(b => b.id === matchedId)?.name}`, 'ok');
    } else {
      addLog('No se pudo identificar el modelo exacto — selecciona manualmente', 'info');
    }

    setDetected({
      chip:      info.chip      || 'ESP32',
      mac:       info.mac       || '—',
      flashSize: info.flashSize || '—',
      rev:       info.rev       || '—',
      features:  info.features  || '—',
      raw:       accumulated.slice(0, 600),
    });

    setDetecting(false);
  }, [serialPort, addLog]);

  // ── Flash firmware ────────────────────────────────────────────────────────

  const handleFwFile = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFwFile(f); setFwStatus('idle'); setFwMsg(''); }
    e.target.value = '';
  };

  // Flash via esptool (USB, siempre funciona sin importar el modo)
  const flashViaEsptool = useCallback(async (binName, appendFwLog) => {
    const proyectosBase = 'C:\\Users\\Fabian\\WSL_ESP32\\Proyectos';
    const binPath = `${proyectosBase}\\${binName}`;

    const portName = await askComPort();
    if (!portName) throw new Error('Puerto COM requerido — operación cancelada');

    appendFwLog(`Puerto: ${portName}`);
    appendFwLog(`Archivo: ${binPath}`);

    // Cerrar el puerto Web Serial si está abierto — esptool necesita acceso exclusivo
    if (serialPort) {
      appendFwLog('Cerrando conexión serial...');
      try {
        readerRef.current?.cancel();
        readerRef.current = null;
        await serialPort.close();
      } catch { /* ignorar si ya estaba cerrado */ }
      setSerialPort(null);
      setSerialStatus('idle');
      addLog('Puerto cerrado para flash (reconecta después)', 'info');
      appendFwLog('Esperando liberación del puerto (2s)...');
      await new Promise(r => setTimeout(r, 2000));
    }

    // Verificar que el puerto esté libre antes de llamar a esptool
    appendFwLog(`Verificando que ${portName} esté disponible...`);
    try {
      const check = await fetch(`/api/firmware/check-port?port=${encodeURIComponent(portName)}`);
      const checkData = await check.json();
      if (!checkData.free) {
        throw new Error(
          `${portName} está ocupado por otro proceso.\n\n` +
          `SOLUCIÓN: Recarga la página (F5) para liberar el handle del Web Serial, ` +
          `luego flashea SIN conectar el puerto serial primero.`
        );
      }
      appendFwLog(`${portName} disponible ✓`);
    } catch (e) {
      if (e.message.includes('ocupado')) throw e;
      // Si el check-port falla por red, continuar de todas formas
      appendFwLog(`Advertencia: no se pudo verificar el puerto (${e.message})`);
    }

    appendFwLog('Iniciando esptool...');

    const response = await fetch('/api/firmware/flash-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portName, binPath, baudRate: 921600, chip: 'auto' }),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} del backend`);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.startsWith('data: ') ? part.slice(6) : part;
        if (!dataLine.trim()) continue;
        if (dataLine.startsWith('RESULT:')) {
          try { finalResult = JSON.parse(dataLine.slice(7)); } catch { }
        } else {
          const isError = dataLine.startsWith('ERROR:');
          const text = dataLine.replace(/^(LOG|ERROR):\s*/, '');
          appendFwLog(text, isError ? 'error' : 'info');
          const pctM = text.match(/(\d+)\s*%/);
          if (pctM) setFwProgress(Math.min(99, parseInt(pctM[1])));
        }
      }
    }
    if (!finalResult?.success) throw new Error(finalResult?.error || 'Error en esptool');
  }, [serialPort, addLog, askComPort]);

  // Flash OTA via HTTP (solo si el ESP32 ya tiene el firmware con /api/firmware)
  const flashViaOTA = useCallback(async (binFile, ip, port, appendFwLog) => {
    appendFwLog(`Conectando a http://${ip}:${port}/api/firmware ...`);
    appendFwLog('Verificando que el ESP32 responda...');

    // Ping primero
    try {
      await fetch(`http://${ip}:${port}/api/ping`, { signal: AbortSignal.timeout(3000) });
    } catch {
      throw new Error(
        `ESP32 en ${ip}:${port} no responde.\n` +
        'Asegúrate de que esté encendido, conectado a la red, y con el firmware WSL SCADA cargado.\n' +
        'Si es la primera vez que flasheas, usa el modo USB (esptool).'
      );
    }

    appendFwLog('ESP32 responde al ping ✓');
    appendFwLog(`Enviando ${fmtSize(binFile.size)}...`);

    const form = new FormData();
    form.append('firmware', binFile);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `http://${ip}:${port}/api/firmware`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        setFwProgress(pct);
        appendFwLog(`Enviando... ${pct}%`);
      }
    };
    await new Promise((resolve, reject) => {
      xhr.onload    = () => xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      xhr.onerror   = () => reject(new Error(`Error de red a ${ip}:${port}`));
      xhr.timeout   = 60000;
      xhr.ontimeout = () => reject(new Error('Timeout — el ESP32 tardó más de 60s'));
      xhr.send(form);
    });
    appendFwLog('✓ Firmware enviado — el ESP32 reiniciará', 'ok');
  }, []);

  const flashFirmware = useCallback(async () => {
    if (!fwFile) { setFwMsg('Selecciona un archivo .bin primero'); return; }

    setFwStatus('flashing');
    setFwProgress(0);
    setFwMsg('');
    setFwLogs([]);

    const appendFwLog = (line, type = 'info') =>
      setFwLogs(prev => [...prev, { ts: new Date(), msg: line, type }]);

    addLog(`Flash: "${fwFile.name}" (${fmtSize(fwFile.size)})`, 'info');

    try {
      const mode = hw?.device?.mode || 'LOCAL';
      const useOTA = (mode === 'REMOTE' || mode === 'AUTO')
                     && hw?.device?.connection?.remote?.ip;

      if (useOTA) {
        const ip   = hw.device.connection.remote.ip;
        const port = hw.device.connection.remote.port || 80;
        appendFwLog(`Modo OTA → ${ip}:${port}`);
        await flashViaOTA(fwFile, ip, port, appendFwLog);
      } else {
        appendFwLog('Modo USB → esptool');
        await flashViaEsptool(fwFile.name, appendFwLog);
      }

      setFwProgress(100);
      setFwStatus('ok');
      setFwMsg('Flash completado — el ESP32 reiniciará');
      addLog('Flash completado', 'ok');

    } catch (e) {
      setFwStatus('error');
      setFwMsg(e.message.split('\n')[0]); // primera línea en el badge
      appendFwLog(`✕ ${e.message}`, 'error');
      addLog(`Error en flash: ${e.message.split('\n')[0]}`, 'error');
    }
  }, [fwFile, hw, flashViaEsptool, flashViaOTA, addLog]);

  // ── Upload script WSL ─────────────────────────────────────────────────────

  const uploadScript = useCallback(async () => {
    const script = currentProject.script?.trim();
    if (!script) { setScriptMsg('No hay script en el proyecto'); setScriptStatus('error'); return; }

    // Parsear
    let ast;
    try {
      ast = new WslParser(script).parse();
    } catch (e) {
      setScriptStatus('error');
      setScriptMsg(`Error de sintaxis: ${e.wslMessage || e.message}`);
      return;
    }

    const mode = hw?.device?.mode || 'SIMULATION';
    if (mode === 'SIMULATION') {
      setScriptStatus('error');
      setScriptMsg('Configura el dispositivo en modo LOCAL o REMOTE primero');
      return;
    }

    setScriptStatus('uploading');
    setScriptMsg('');
    addLog('Enviando script WSL...', 'info');

    try {
      if (mode === 'REMOTE' || mode === 'AUTO') {
        const ip   = hw.device.connection.remote.ip;
        const port = hw.device.connection.remote.port || 80;
        const res  = await fetch(`http://${ip}:${port}/api/script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ast),
          signal: AbortSignal.timeout(8000),
        });
        const data = await res.json();
        if (data.ok) {
          setScriptStatus('ok');
          setScriptMsg(data.msg || 'Script cargado correctamente');
          addLog('Script WSL cargado en el ESP32', 'ok');
        } else {
          throw new Error(data.msg || 'Error en el ESP32');
        }
      } else if (mode === 'LOCAL' && serialPort) {
        const writer = serialPort.writable.getWriter();
        const cmd = JSON.stringify({ cmd: 'LOAD_SCRIPT', ast }) + '\n';
        await writer.write(new TextEncoder().encode(cmd));
        writer.releaseLock();
        setScriptStatus('ok');
        setScriptMsg('Script enviado por Serial');
        addLog('Script WSL enviado por puerto serie', 'ok');
      } else {
        throw new Error('Conecta el puerto serial primero (modo LOCAL)');
      }
    } catch (e) {
      setScriptStatus('error');
      setScriptMsg(e.message);
      addLog(`Error al enviar script: ${e.message}`, 'error');
    }

    setTimeout(() => { setScriptStatus('idle'); setScriptMsg(''); }, 5000);
  }, [currentProject.script, hw, serialPort, addLog]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
    <div style={s.root}>

      {/* ── Columna izquierda: Selector de placa ── */}
      <div style={s.colLeft}>

        <div style={s.sectionTitle}>Seleccionar placa</div>

        <div style={s.boardGrid}>
          {BOARD_CATALOG.map(b => (
            <button
              key={b.id}
              onClick={() => setBoardId(b.id)}
              style={{ ...s.boardCard, ...(boardId === b.id ? s.boardCardActive : {}) }}
            >
              <span style={s.boardEmoji}>{b.img}</span>
              <div style={s.boardCardName}>{b.name}</div>
              <div style={s.boardCardChip}>{b.chip}</div>
              {boardId === b.id && <span style={s.boardCardCheck}>✓</span>}
            </button>
          ))}
        </div>

        {/* Specs de la placa seleccionada */}
        <div style={s.boardSpecs}>
          <div style={s.boardSpecsTitle}>{board.img} {board.name}</div>
          <div style={s.boardSpecsVendor}>{board.vendor}</div>
          <p style={s.boardSpecsDesc}>{board.description}</p>
          <div style={s.specGrid}>
            {[
              ['Chip',   board.chip],
              ['Flash',  board.flash],
              ['RAM',    board.ram],
              ['GPIOs',  board.gpios ?? '—'],
              ['WiFi',   board.wifi ? '✓' : '✕'],
              ['BLE',    board.ble  ? '✓' : '✕'],
            ].map(([k, v]) => (
              <div key={k} style={s.specRow}>
                <span style={s.specKey}>{k}</span>
                <span style={s.specVal}>{v}</span>
              </div>
            ))}
          </div>

          {boardId === 'custom' && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'Nombre', key: 'name' },
                { label: 'Chip',   key: 'chip'  },
                { label: 'Flash',  key: 'flash' },
                { label: 'RAM',    key: 'ram'   },
              ].map(({ label, key }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b', width: 44, flexShrink: 0 }}>{label}</span>
                  <input
                    value={customBoard[key]}
                    onChange={e => setCustomBoard(p => ({ ...p, [key]: e.target.value }))}
                    style={s.inlineInput}
                  />
                </div>
              ))}
            </div>
          )}

          {board.pinout && (
            <button
              onClick={() => setShowPinout(p => !p)}
              style={{ ...s.btnSecondary, marginTop: 10, width: '100%', justifyContent: 'center' }}
            >
              {showPinout ? '▲ Ocultar pinout' : '📌 Ver pinout'}
            </button>
          )}
        </div>

        {showPinout && board.pinout && (
          <div style={{ overflowY: 'auto', borderTop: '1px solid #1e293b', flexShrink: 0, maxHeight: 340 }}>
            <PinoutView board={board} />
          </div>
        )}
      </div>

      {/* ── Columna central: Conexión + Firmware + Script ── */}
      <div style={s.colCenter}>

        {/* ─ Conexión serial ─ */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardIcon}>🔌</span>
            <span style={s.cardTitle}>Conexión Serial (Web Serial API)</span>
            <span style={{ ...s.badge, background: serialStatus === 'connected' ? '#14532d' : '#1e293b', color: statusColor(serialStatus === 'connected' ? 'ok' : serialStatus === 'error' ? 'error' : 'idle') }}>
              {serialStatus === 'connected' ? '● Conectado' : serialStatus === 'connecting' ? '⏳ Conectando...' : '○ Desconectado'}
            </span>
          </div>

          {!hasSerial && (
            <div style={s.warning}>⚠ Web Serial no está disponible. Usa Chrome o Edge para la conexión directa.</div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={serialBaud}
              onChange={e => setSerialBaud(Number(e.target.value))}
              disabled={serialStatus === 'connected'}
              style={s.select}
            >
              {BAUD_OPTIONS.map(b => <option key={b} value={b}>{b} bps</option>)}
            </select>

            {serialStatus !== 'connected' ? (
              <button onClick={connectSerial} disabled={!hasSerial} style={s.btnPrimary}>
                🔗 Conectar puerto
              </button>
            ) : (
              <>
                <button onClick={disconnectSerial} style={s.btnDanger}>✕ Desconectar</button>
                <button onClick={detectBoard} disabled={detecting} style={s.btnSecondary}>
                  {detecting ? '⏳ Detectando...' : '🔍 Identificar placa'}
                </button>
              </>
            )}
          </div>

          {detected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={s.detectedBox}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 13 }}>
                    ✓ {BOARD_CATALOG.find(b => b.id === boardId)?.name || 'Placa detectada'}
                  </span>
                  <span style={{ fontSize: 10, color: '#475569' }}>bootrom</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 12 }}>
                  {[
                    ['Chip',       detected.chip],
                    ['MAC',        detected.mac],
                    ['Flash',      detected.flashSize],
                    ['Revisión',   detected.rev],
                    ['Features',   detected.features],
                  ].map(([k, v]) => v && v !== '—' ? (
                    <div key={k} style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: '#475569', minWidth: 60 }}>{k}</span>
                      <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{v}</span>
                    </div>
                  ) : null)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─ Flash firmware ─ */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardIcon}>⚡</span>
            <span style={s.cardTitle}>Cargar Firmware</span>
            <span style={{ ...s.badge, background: fwStatus === 'ok' ? '#14532d' : fwStatus === 'error' ? '#450a0a' : '#1e293b', color: statusColor(fwStatus === 'ok' ? 'ok' : fwStatus === 'error' ? 'error' : fwStatus === 'flashing' ? 'busy' : 'idle') }}>
              {fwStatus === 'ok' ? '✓ Listo' : fwStatus === 'error' ? '✕ Error' : fwStatus === 'flashing' ? '⏳ Flasheando...' : '○ En espera'}
            </span>
          </div>

          <p style={s.cardDesc}>
            Selecciona el <code style={s.code}>.bin</code> generado en F3 y haz clic en <strong>Flashear</strong>.{' '}
            {(hw?.device?.mode === 'REMOTE' || hw?.device?.mode === 'AUTO') && hw?.device?.connection?.remote?.ip
              ? <>Modo <strong>OTA</strong> — se envía por WiFi a <code style={s.code}>{hw.device.connection.remote.ip}</code>.</>
              : <>Modo <strong>USB</strong> — flashea por esptool sin necesidad de conectar el puerto serial.</>
            }
          </p>

          {/* Aviso si el serial está conectado en modo USB */}
          {serialStatus === 'connected' && !(hw?.device?.mode === 'REMOTE' || hw?.device?.mode === 'AUTO') && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#451a0322', border: '1px solid #92400e', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#fbbf24' }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>
                El puerto serial está conectado. Al flashear se cerrará automáticamente.
                Si el error persiste, <strong>recarga la página (F5)</strong> para liberar
                el handle y flashea sin conectar el serial primero.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => fwInputRef.current?.click()} style={s.btnSecondary}>
              📁 {fwFile ? fwFile.name : 'Seleccionar .bin'}
            </button>
            {fwFile && (
              <span style={{ fontSize: 11, color: '#64748b' }}>{fmtSize(fwFile.size)}</span>
            )}
            <button
              onClick={flashFirmware}
              disabled={!fwFile || fwStatus === 'flashing'}
              style={{ ...s.btnPrimary, opacity: (!fwFile || fwStatus === 'flashing') ? 0.4 : 1 }}
            >
              ⚡ Flashear
            </button>
            <input ref={fwInputRef} type="file" accept=".bin" style={{ display: 'none' }} onChange={handleFwFile} />
          </div>

          {/* Barra de progreso */}
          {(fwStatus === 'flashing' || fwStatus === 'ok') && fwProgress > 0 && (
            <div style={s.progressWrap}>
              <div style={{ ...s.progressBar, width: `${fwProgress}%`, background: fwStatus === 'ok' ? '#22c55e' : '#3b82f6' }} />
              <span style={s.progressLabel}>{fwProgress}%</span>
            </div>
          )}

          {/* Panel de logs de flash en tiempo real */}
          {fwLogs.length > 0 && (
            <div style={{ marginTop: 8, background: '#070d1a', border: '1px solid #1e293b', borderRadius: 6, maxHeight: 200, overflowY: 'auto', padding: '8px 12px' }}>
              {fwLogs.map((e, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: "'Fira Code', monospace", lineHeight: 1.5, color: e.type === 'error' ? '#ef4444' : e.type === 'ok' ? '#22c55e' : '#7dd3fc', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {e.msg}
                </div>
              ))}
              <div ref={fwLogsEndRef} />
            </div>
          )}

          {fwMsg && (
            <div style={{ ...s.msgBox, color: fwStatus === 'error' ? '#ef4444' : '#22c55e' }}>
              {fwStatus === 'error' ? '✕ ' : '✓ '}{fwMsg}
            </div>
          )}
        </div>

        {/* ─ Script WSL hot-reload ─ */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardIcon}>🔧</span>
            <span style={s.cardTitle}>Cargar Script WSL</span>
            <span style={{ ...s.badge, background: scriptStatus === 'ok' ? '#14532d' : scriptStatus === 'error' ? '#450a0a' : '#1e293b', color: statusColor(scriptStatus === 'ok' ? 'ok' : scriptStatus === 'error' ? 'error' : scriptStatus === 'uploading' ? 'busy' : 'idle') }}>
              {scriptStatus === 'ok' ? '✓ Cargado' : scriptStatus === 'error' ? '✕ Error' : scriptStatus === 'uploading' ? '⏳ Enviando...' : '○ En espera'}
            </span>
          </div>

          <p style={s.cardDesc}>
            Envía el script WSL actual al ESP32 sin recompilar el firmware.
            El dispositivo parsea el AST en tiempo de ejecución (hot-reload).
          </p>

          {/* Resumen del script */}
          <ScriptSummary script={currentProject.script} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <button
              onClick={uploadScript}
              disabled={scriptStatus === 'uploading'}
              style={{ ...s.btnPrimary, opacity: scriptStatus === 'uploading' ? 0.4 : 1 }}
            >
              ⬆ Enviar script al dispositivo
            </button>
          </div>

          {scriptMsg && (
            <div style={{ ...s.msgBox, color: scriptStatus === 'error' ? '#ef4444' : '#22c55e' }}>
              {scriptStatus === 'error' ? '✕ ' : '✓ '}{scriptMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── Columna derecha: Log serial ── */}
      <div style={s.colRight}>
        <div style={s.sectionTitle}>
          Log serial
          <button onClick={() => setSerialLog([])} style={s.clearBtn} title="Limpiar log">✕</button>
        </div>
        <div style={s.logBox}>
          {serialLog.length === 0 ? (
            <div style={{ color: '#334155', fontSize: 12, padding: '8px 0' }}>Sin mensajes</div>
          ) : (
            serialLog.map((e, i) => (
              <div key={i} style={{ ...s.logLine, color: e.type === 'error' ? '#ef4444' : e.type === 'ok' ? '#22c55e' : e.type === 'device' ? '#7dd3fc' : e.type === 'separator' ? '#334155' : '#64748b' }}>
                <span style={s.logTs}>{e.ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                {e.msg}
              </div>
            ))
          )}
        </div>
      </div>

    </div>

    {/* ── Modal: ingresar puerto COM ── */}
    {comModal.open && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
        onClick={comModalCancel}
      >
        <div style={{
          background: '#0d1117', border: '1px solid #1e3a5f',
          borderRadius: 12, padding: '28px 32px', width: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', fontFamily: "'JetBrains Mono',monospace" }}>
                Flash via USB
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                {currentProject?.name || 'Proyecto'}
              </div>
            </div>
          </div>

          {/* Descripción */}
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            Ingresa el puerto COM del ESP32 conectado por USB.<br />
            Verifica en <span style={{ color: '#7dd3fc', fontFamily: 'monospace' }}>
              Administrador de dispositivos → Puertos (COM y LPT)
            </span>
          </div>

          {/* Input */}
          <div>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 6, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              PUERTO COM
            </div>
            <input
              ref={comModalInputRef}
              value={comModal.value}
              onChange={e => setComModal(m => ({ ...m, value: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') comModalConfirm(); if (e.key === 'Escape') comModalCancel(); }}
              placeholder="COM3"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0a0f1a', border: '1.5px solid #1e3a5f',
                borderRadius: 6, padding: '10px 14px',
                fontSize: 15, fontFamily: "'JetBrains Mono',monospace",
                color: '#7dd3fc', outline: 'none',
                letterSpacing: 2,
              }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = '#1e3a5f'}
            />
          </div>

          {/* Tip CP2102 */}
          <div style={{ fontSize: 11, color: '#334155', background: '#0a0f1a', borderRadius: 6, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: '#f59e0b', flexShrink: 0 }}>ℹ</span>
            <span>El CP2102 suele aparecer como <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>Silicon Labs CP210x</span> en Administrador de dispositivos.</span>
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={comModalCancel}
              style={{ padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid #1e293b', color: '#64748b', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}
            >
              Cancelar
            </button>
            <button
              onClick={comModalConfirm}
              style={{ padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#3b82f6', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}
            >
              ⚡ Flashear
            </button>
          </div>
        </div>
      </div>
    )}

    </>
  );
}

// ─── Sub-componente: resumen del script ──────────────────────────────────────

function ScriptSummary({ script }) {
  if (!script?.trim()) return <div style={{ color: '#475569', fontSize: 12 }}>Sin script en el proyecto</div>;

  let info = null;
  try {
    const ast = new WslParser(script).parse();
    const events = ast.events.map(e => {
      const k = e.event.kind;
      const detail = k === 'INTERVAL' ? ` ${e.event.value}${e.event.unit}` : k === 'CHANGE' ? ` "${e.event.tag}"` : '';
      return `ON ${k}${detail}`;
    });
    info = { ok: true, vars: ast.vars?.length ?? 0, events };
  } catch (e) {
    info = { ok: false, error: e.wslMessage || e.message };
  }

  if (!info.ok) return (
    <div style={{ color: '#ef4444', fontSize: 12, background: '#450a0a22', padding: '6px 10px', borderRadius: 4 }}>
      ✕ Error de sintaxis: {info.error}
    </div>
  );

  return (
    <div style={{ fontSize: 12, color: '#94a3b8', background: '#0f172a', padding: '8px 12px', borderRadius: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <span style={{ color: '#22c55e' }}>✓ Válido</span>
      <span>{info.vars} variable{info.vars !== 1 ? 's' : ''}</span>
      <span>{info.events.length} bloque{info.events.length !== 1 ? 's' : ''}</span>
      <span style={{ color: '#475569' }}>{info.events.join(' · ')}</span>
    </div>
  );
}

// ─── Sub-componente: diagrama de pinout ──────────────────────────────────────

function PinoutView({ board }) {
  const { left, right } = board.pinout;
  const rows = Math.max(left.length, right.length);

  const pinColor = (name) => {
    if (!name) return '#1e293b';
    if (name === 'GND')                                   return '#374151';
    if (name === '3V3' || name === 'V5' || name === 'V3') return '#7f1d1d';
    if (name === 'EN' || name === 'RST')                  return '#854d0e';
    if (name === 'TXD' || name === 'RXD')                 return '#1e3a5f';
    if ((board.sdPins || []).includes(name))              return '#312e81';
    if ((board.inputOnly || []).includes(name))           return '#064e3b';
    return '#1a2a3a';
  };

  const pinTextColor = (name) => {
    if (!name)                                            return '#334155';
    if (name === 'GND')                                   return '#9ca3af';
    if (name === '3V3' || name === 'V5' || name === 'V3') return '#fca5a5';
    if (name === 'EN' || name === 'RST')                  return '#fcd34d';
    if (name === 'TXD' || name === 'RXD')                 return '#7dd3fc';
    if ((board.sdPins || []).includes(name))              return '#a5b4fc';
    if ((board.inputOnly || []).includes(name))           return '#6ee7b7';
    return '#94a3b8';
  };

  return (
    <div style={{ padding: '10px 12px', background: '#070d1a' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
        Pinout — {board.name}
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 9 }}>
        {[
          { color: '#7f1d1d', text: 'PWR', textColor: '#fca5a5' },
          { color: '#374151', text: 'GND', textColor: '#9ca3af' },
          { color: '#1e3a5f', text: 'UART', textColor: '#7dd3fc' },
          { color: '#064e3b', text: 'Input-only', textColor: '#6ee7b7' },
          { color: '#312e81', text: 'SD/SPI', textColor: '#a5b4fc' },
          { color: '#1a2a3a', text: 'GPIO', textColor: '#94a3b8' },
        ].map(({ color, text, textColor }) => (
          <span key={text} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, border: '1px solid #334155', display: 'inline-block' }} />
            <span style={{ color: textColor }}>{text}</span>
          </span>
        ))}
      </div>

      {/* Diagrama de pines */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start', justifyContent: 'center' }}>

        {/* Columna izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Array.from({ length: rows }, (_, i) => {
            const name = left[i] || '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 9, color: pinTextColor(name), width: 38, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                  {name}
                </span>
                <span style={{ width: 10, height: 14, borderRadius: 2, background: pinColor(name), border: '1px solid #334155', display: 'block' }} />
              </div>
            );
          })}
        </div>

        {/* PCB central */}
        <div style={{
          width: 40, background: '#0a3d0a', border: '2px solid #166534',
          borderRadius: 4, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          minHeight: rows * 16,
        }}>
          <span style={{ fontSize: 8, color: '#22c55e', fontWeight: 700, writingMode: 'vertical-rl', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {board.chip}
          </span>
          <span style={{ fontSize: 7, color: '#166534', marginTop: 4, writingMode: 'vertical-rl' }}>
            {board.gpios}p
          </span>
        </div>

        {/* Columna derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Array.from({ length: rows }, (_, i) => {
            const name = right[i] || '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 10, height: 14, borderRadius: 2, background: pinColor(name), border: '1px solid #334155', display: 'block' }} />
                <span style={{ fontSize: 9, color: pinTextColor(name), width: 38, fontFamily: 'monospace', fontWeight: 600 }}>
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {board.inputOnly?.length > 0 && (
        <div style={{ fontSize: 10, color: '#475569', marginTop: 8 }}>
          * {board.inputOnly.join(', ')} → solo entrada (sin DAC/PWM)
        </div>
      )}
      {board.sdPins?.length > 0 && (
        <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
          ‼ {board.sdPins.join(', ')} → conectados a Flash interno (usar con precaución)
        </div>
      )}
    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = {
  root: {
    display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden',
    background: '#0f172a', color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13,
  },

  // Columnas
  colLeft: {
    width: 240, flexShrink: 0, borderRight: '1px solid #1e293b',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: '#0a1120',
  },
  colCenter: {
    flex: 1, overflowY: 'auto', padding: 20,
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  colRight: {
    width: 280, flexShrink: 0, borderLeft: '1px solid #1e293b',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: '#0a1120',
  },

  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#475569',
    letterSpacing: 0.8, textTransform: 'uppercase',
    padding: '10px 12px 6px',
    borderBottom: '1px solid #1e293b',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },

  // Grid de placas
  boardGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 6, padding: '10px 10px 0', overflowY: 'auto', flex: 1,
  },
  boardCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    padding: '8px 4px', borderRadius: 6,
    border: '1px solid #1e293b', background: 'transparent',
    cursor: 'pointer', color: '#64748b', position: 'relative',
    transition: 'all 0.15s', fontSize: 11,
  },
  boardCardActive: {
    border: '1px solid #38bdf8', background: '#38bdf811', color: '#38bdf8',
  },
  boardEmoji:     { fontSize: 20, lineHeight: 1 },
  boardCardName:  { fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 },
  boardCardChip:  { fontSize: 9, color: '#475569' },
  boardCardCheck: { position: 'absolute', top: 3, right: 5, color: '#38bdf8', fontSize: 10 },

  // Specs
  boardSpecs: {
    padding: '10px 12px', borderTop: '1px solid #1e293b', flexShrink: 0,
    background: '#0f172a',
  },
  boardSpecsTitle:  { fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 },
  boardSpecsVendor: { fontSize: 10, color: '#475569', marginBottom: 6 },
  boardSpecsDesc:   { fontSize: 11, color: '#64748b', margin: '0 0 10px', lineHeight: 1.5 },
  specGrid: { display: 'flex', flexDirection: 'column', gap: 3 },
  specRow:  { display: 'flex', justifyContent: 'space-between', fontSize: 11 },
  specKey:  { color: '#475569' },
  specVal:  { color: '#94a3b8', fontWeight: 600 },

  // Cards de acción
  card: {
    background: '#1e293b', borderRadius: 10,
    border: '1px solid #334155', padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  cardIcon:  { fontSize: 18, flexShrink: 0 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#e2e8f0', flex: 1 },
  cardDesc:  { fontSize: 12, color: '#64748b', margin: 0, lineHeight: 1.6 },

  badge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 20,
    fontWeight: 600, flexShrink: 0,
  },

  warning: {
    background: '#451a0322', border: '1px solid #f59e0b44',
    borderRadius: 6, padding: '8px 12px',
    fontSize: 12, color: '#f59e0b',
  },

  detectedBox: {
    background: '#052e1622', border: '1px solid #22c55e44',
    borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#94a3b8',
  },

  // Progreso flash
  progressWrap: {
    height: 20, background: '#0f172a', borderRadius: 4,
    overflow: 'hidden', position: 'relative',
  },
  progressBar: {
    height: '100%', background: '#3b82f6',
    borderRadius: 4, transition: 'width 0.2s',
  },
  progressLabel: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    fontSize: 11, color: '#e2e8f0', fontWeight: 600,
  },

  msgBox: {
    fontSize: 12, padding: '6px 10px',
    background: '#0f172a', borderRadius: 4,
  },

  // Controles
  select: {
    background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
    color: '#e2e8f0', fontSize: 12, padding: '5px 8px', cursor: 'pointer',
  },
  inlineInput: {
    flex: 1, background: '#0f172a', border: '1px solid #334155',
    borderRadius: 4, color: '#e2e8f0', fontSize: 11,
    padding: '3px 6px', outline: 'none',
  },
  btnPrimary: {
    background: '#1d4ed8', border: 'none', borderRadius: 6,
    color: '#fff', fontSize: 12, fontWeight: 600,
    padding: '6px 14px', cursor: 'pointer',
  },
  btnSecondary: {
    display: 'flex', alignItems: 'center',
    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
    color: '#94a3b8', fontSize: 12, fontWeight: 600,
    padding: '6px 14px', cursor: 'pointer',
  },
  btnDanger: {
    background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6,
    color: '#fca5a5', fontSize: 12, fontWeight: 600,
    padding: '6px 14px', cursor: 'pointer',
  },
  code: {
    background: '#0f172a', padding: '1px 5px', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11,
  },

  // Log serial
  logBox: {
    flex: 1, overflowY: 'auto', padding: '6px 10px',
    fontFamily: "'Fira Code', 'Monaco', monospace",
    fontSize: 11, display: 'flex', flexDirection: 'column', gap: 1,
  },
  logLine: { display: 'flex', gap: 8, lineHeight: 1.5 },
  logTs:   { color: '#334155', flexShrink: 0, fontSize: 10, paddingTop: 1 },
  clearBtn: {
    background: 'transparent', border: 'none',
    color: '#475569', cursor: 'pointer', fontSize: 11,
    padding: '0 2px',
  },
};
