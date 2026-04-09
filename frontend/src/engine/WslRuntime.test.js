/**
 * WslRuntime.test.js
 * Tests de integración para TagManager, Transport y WslRuntime.
 * Ejecutar: node WslRuntime.test.js
 */

import { TagManager, buildTagsFromHardware } from './TagManager.js';
import { SimulationTransport, createTransport, TransportError } from './Transport.js';
import { WslRuntime, WslRuntimeError } from './WslRuntime.js';

// ─── Mini framework ───────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const PENDING = [];

function test(name, fn) {
  PENDING.push({ name, fn });
}

async function runAll() {
  for (const { name, fn } of PENDING) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
      failed++;
    }
  }
}

function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n    Esperado: ${b}\n    Obtenido: ${a}`);
}

function assertTrue(val, msg = '') {
  if (!val) throw new Error(msg || `Se esperaba true, obtenido: ${val}`);
}

function assertAlmost(actual, expected, tolerance = 0.1, msg = '') {
  if (Math.abs(actual - expected) > tolerance)
    throw new Error(`${msg}\n    |${actual} - ${expected}| > ${tolerance}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Hardware de prueba ───────────────────────────────────────────────────────

const DEMO_HW = {
  device: {
    id: 'esp01',
    name: 'Test Device',
    mode: 'SIMULATION',
    connection: { remote: { ip: '192.168.1.10', port: 80 }, local: { baud: 115200 } },
  },
  native: {
    digital_in:  [{ gpio: 4, label: 'DIN0' }, { gpio: 5, label: 'DIN1' }],
    digital_out: [{ gpio: 16, label: 'DOUT0', default: 0 }, { gpio: 17, label: 'DOUT1', default: 0 }],
    analog_in:   [{ gpio: 32, label: 'AIN0' }, { gpio: 33, label: 'AIN1' }],
    pwm_out:     [{ gpio: 25, label: 'PWM0' }],
  },
  expansion: {
    ic595:    { enabled: true,  count: 1, pins: { data: 23, clock: 22, latch: 21 }, outputs: [] },
    ic165:    { enabled: true,  count: 1, pins: { data: 19, clock: 22, load: 20  }, inputs: [] },
    ads1115:  { enabled: true,  count: 1, pins: { sda: 21, scl: 22 },
                devices: [{ index: 0, addr: '0x48', channels: [
                  { ch: 0, label: 'Presión', scale_min: 0, scale_max: 10 },
                  { ch: 1, label: 'Temp',    scale_min: 0, scale_max: 100 },
                ]}] },
    mcp23017: { enabled: false, count: 0, devices: [] },
  },
};

// ─── Tests: TagManager ────────────────────────────────────────────────────────

console.log('\n=== TAG MANAGER ===');

test('buildTagsFromHardware genera tags nativos', () => {
  const map = buildTagsFromHardware(DEMO_HW);
  assertTrue(map.has('esp01.din.gpio4'),   'digital in');
  assertTrue(map.has('esp01.dout.gpio16'), 'digital out');
  assertTrue(map.has('esp01.ain.adc32'),   'analog in');
  assertTrue(map.has('esp01.pwm.gpio25'),  'pwm');
});

test('buildTagsFromHardware genera tags de expansión', () => {
  const map = buildTagsFromHardware(DEMO_HW);
  assertTrue(map.has('esp01.595.out.0'), '595 out.0');
  assertTrue(map.has('esp01.595.out.7'), '595 out.7');
  assertTrue(map.has('esp01.165.in.0'),  '165 in.0');
  assertTrue(map.has('esp01.165.in.7'),  '165 in.7');
  assertTrue(map.has('esp01.ads.0.ch0'), 'ads ch0');
  assertTrue(map.has('esp01.ads.0.ch1'), 'ads ch1');
});

test('TagManager.getValue retorna null en tag desconocido', () => {
  const tm = new TagManager(DEMO_HW);
  assertEqual(tm.getValue('no.existe'), null);
});

test('TagManager.setValue / getValue ida y vuelta', () => {
  const tm = new TagManager(DEMO_HW);
  tm.setValue('esp01.ain.adc32', 3.14);
  assertEqual(tm.getValue('esp01.ain.adc32'), 3.14);
});

test('TagManager dispara onChange solo cuando el valor cambia', () => {
  const tm = new TagManager(DEMO_HW);
  let calls = 0;
  tm.onChange('esp01.din.gpio4', () => calls++);

  tm.setValue('esp01.din.gpio4', true);   // cambio: false → true
  tm.setValue('esp01.din.gpio4', true);   // sin cambio
  tm.setValue('esp01.din.gpio4', false);  // cambio: true → false
  assertEqual(calls, 2);
});

test('TagManager.onChange entrega valor y prev', () => {
  const tm = new TagManager(DEMO_HW);
  let received = null;
  tm.onChange('esp01.ain.adc32', (value, prev) => { received = { value, prev }; });
  tm.setValue('esp01.ain.adc32', 42);
  assertEqual(received.value, 42);
  assertEqual(received.prev,  0);
});

test('TagManager unsub cancela correctamente', () => {
  const tm = new TagManager(DEMO_HW);
  let calls = 0;
  const unsub = tm.onChange('esp01.din.gpio4', () => calls++);
  tm.setValue('esp01.din.gpio4', true);
  unsub();
  tm.setValue('esp01.din.gpio4', false);
  assertEqual(calls, 1, 'Solo debería haber disparado 1 vez');
});

test('TagManager.snapshot retorna objeto plano', () => {
  const tm = new TagManager(DEMO_HW);
  tm.setValue('esp01.ain.adc32', 99);
  const snap = tm.snapshot();
  assertTrue(typeof snap === 'object', 'snapshot es objeto');
  assertEqual(snap['esp01.ain.adc32'], 99);
});

test('TagManager.applyTelemetry actualiza múltiples tags', () => {
  const tm = new TagManager(DEMO_HW);
  let changed = [];
  tm.onChange('esp01.ain.adc32', v => changed.push(v));
  tm.onChange('esp01.ain.adc33', v => changed.push(v));

  tm.applyTelemetry({ 'esp01.ain.adc32': 10, 'esp01.ain.adc33': 20 });
  assertEqual(changed.length, 2);
  assertTrue(changed.includes(10));
  assertTrue(changed.includes(20));
});

// ─── Tests: SimulationTransport ───────────────────────────────────────────────

console.log('\n=== SIMULATION TRANSPORT ===');

test('SimulationTransport.connect retorna true', async () => {
  const t = new SimulationTransport(DEMO_HW);
  const ok = await t.connect();
  assertEqual(ok, true);
  assertEqual(t.getMode(), 'SIMULATION');
  t.disconnect();
});

test('SimulationTransport.readAll devuelve objeto con tags', async () => {
  const t = new SimulationTransport(DEMO_HW);
  await t.connect();
  const data = await t.readAll();
  assertTrue(typeof data === 'object', 'data es objeto');
  assertTrue('esp01.din.gpio4' in data, 'tiene din.gpio4');
  assertTrue('esp01.ain.adc32' in data, 'tiene ain.adc32');
  t.disconnect();
});

test('SimulationTransport.write persiste valor', async () => {
  const t = new SimulationTransport(DEMO_HW);
  await t.connect();
  await t.write('esp01.595.out.0', true);
  const data = await t.readAll();
  assertEqual(data['esp01.595.out.0'], true);
  t.disconnect();
});

test('createTransport SIMULATION devuelve SimulationTransport', () => {
  const t = createTransport(DEMO_HW, 'SIMULATION');
  assertEqual(t.getMode(), 'SIMULATION');
});

// ─── Tests: WslRuntime ────────────────────────────────────────────────────────

console.log('\n=== WSL RUNTIME ===');

function makeRuntime(script, hw = DEMO_HW) {
  const transport = new SimulationTransport(hw);
  return new WslRuntime({ hardware: hw, script, transport });
}

test('Runtime arranca y se detiene limpiamente', async () => {
  const rt = makeRuntime('ON STARTUP\n  LOG("hola")\nEND');
  await rt.start();
  await sleep(50);
  assertTrue(rt.isRunning());
  await rt.stop();
  assertTrue(!rt.isRunning());
});

test('ON STARTUP ejecuta LOG', async () => {
  const rt = makeRuntime('ON STARTUP\n  LOG("sistema ok")\nEND');
  const logs = [];
  rt.onLog = entry => logs.push(entry.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'sistema ok'), `Logs: ${JSON.stringify(logs)}`);
});

test('ON STARTUP ejecuta asignación de variable', async () => {
  const rt = makeRuntime('ON STARTUP\n  contador = 5\n  LOG(contador)\nEND');
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => String(m) === '5'), `Logs: ${JSON.stringify(logs)}`);
});

test('ON STARTUP SET escribe en tag y notifica', async () => {
  const rt = makeRuntime('ON STARTUP\n  SET("esp01.595.out.0", TRUE)\nEND');
  const changes = [];
  rt.onTagChange = (tag, val) => changes.push({ tag, val });
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(changes.some(c => c.tag === 'esp01.595.out.0' && c.val === true),
    `Cambios: ${JSON.stringify(changes)}`);
});

test('IF THEN ejecuta rama correcta', async () => {
  const script = `
ON STARTUP
  x = 10
  IF x > 5 THEN
    LOG("mayor")
  ELSE
    LOG("menor")
  END
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'mayor'), `Logs: ${JSON.stringify(logs)}`);
  assertTrue(!logs.some(m => m === 'menor'));
});

test('FOR itera el número correcto de veces', async () => {
  const script = `
ON STARTUP
  total = 0
  FOR i FROM 1 TO 5
    total = total + i
  END
  LOG(total)
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(100);
  await rt.stop();
  // 1+2+3+4+5 = 15
  assertTrue(logs.some(m => String(m) === '15'), `Logs: ${JSON.stringify(logs)}`);
});

test('WHILE con guarda de iteraciones', async () => {
  const script = `
ON STARTUP
  n = 0
  WHILE n < 3 DO
    n = n + 1
  END
  LOG(n)
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(200);
  await rt.stop();
  assertTrue(logs.some(m => String(m) === '3'), `Logs: ${JSON.stringify(logs)}`);
});

test('ALARM genera entrada en historial y dispara callback', async () => {
  const script = `
ON STARTUP
  ALARM("presion critica", CRITICAL)
END`;
  const rt = makeRuntime(script);
  const alarms = [];
  rt.onAlarm = a => alarms.push(a);
  await rt.start();
  await sleep(100);
  await rt.stop();
  assertTrue(alarms.length > 0, 'Debe haber al menos una alarma');
  assertEqual(alarms[0].level,   'CRITICAL');
  assertEqual(alarms[0].message, 'presion critica');
});

test('NOTIFY dispara callback de notificación', async () => {
  const rt = makeRuntime('ON STARTUP\n  NOTIFY("Atención operador")\nEND');
  const notifs = [];
  rt.onNotify = m => notifs.push(m);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(notifs.includes('Atención operador'));
});

test('WAIT pausa la ejecución', async () => {
  const script = `
ON STARTUP
  LOG("antes")
  WAIT(100)
  LOG("despues")
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(250);
  await rt.stop();
  assertTrue(logs.indexOf('antes')  < logs.indexOf('despues'), 'orden correcto');
});

test('READ devuelve valor del TagManager', async () => {
  const transport = new SimulationTransport(DEMO_HW);
  await transport.write('esp01.ain.adc32', 77);  // preinjectar
  const rt = new WslRuntime({ hardware: DEMO_HW, script: `
ON STARTUP
  v = READ("esp01.ain.adc32")
  LOG(v)
END`, transport });
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(100);
  await rt.stop();
  assertTrue(logs.some(m => String(m) === '77'), `Logs: ${JSON.stringify(logs)}`);
});

test('MODE() retorna "SIMULATION"', async () => {
  const rt = makeRuntime('ON STARTUP\n  LOG(MODE())\nEND');
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'SIMULATION'), `Logs: ${JSON.stringify(logs)}`);
});

test('ON INTERVAL registra timer', async () => {
  const rt = makeRuntime(`
ON INTERVAL 1s
  LOG("tick")
END`);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(2500);
  await rt.stop();
  const ticks = logs.filter(m => m === 'tick').length;
  assertTrue(ticks >= 2, `Esperaba ≥2 ticks, obtuvo ${ticks}`);
});

test('Error de parse en start lanza error y llama onError', async () => {
  const rt = makeRuntime('ON STARTUP\n  IF TRUE\n  LOG("sin THEN")\nEND');
  let err = null;
  rt.onError = e => (err = e);
  let threw = false;
  try { await rt.start(); } catch { threw = true; }
  assertTrue(threw, 'Debería haber lanzado');
  assertTrue(err !== null, 'Debería haber llamado onError');
});

test('emitClick dispara ON CLICK correspondiente', async () => {
  const rt = makeRuntime(`
ON CLICK "btn-motor"
  LOG("motor clicked")
END`);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await rt.emitClick('btn-motor');
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'motor clicked'), `Logs: ${JSON.stringify(logs)}`);
});

test('emitClick no dispara handler de otro objeto', async () => {
  const rt = makeRuntime(`
ON CLICK "btn-a"
  LOG("A")
END
ON CLICK "btn-b"
  LOG("B")
END`);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await rt.emitClick('btn-b');
  await sleep(50);
  await rt.stop();
  assertTrue( logs.some(m => m === 'B'));
  assertTrue(!logs.some(m => m === 'A'));
});

test('Operadores aritméticos: suma, resta, multiplicación, división', async () => {
  const script = `
ON STARTUP
  a = 10 + 3
  b = 10 - 3
  c = 10 * 3
  d = 10 / 4
  LOG(a)
  LOG(b)
  LOG(c)
  LOG(d)
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(String(e.msg));
  await rt.start();
  await sleep(100);
  await rt.stop();
  assertTrue(logs.includes('13'),   `suma: ${JSON.stringify(logs)}`);
  assertTrue(logs.includes('7'),    `resta`);
  assertTrue(logs.includes('30'),   `mult`);
  assertTrue(logs.includes('2.5'),  `div`);
});

test('Operadores lógicos: AND, OR, NOT', async () => {
  const script = `
ON STARTUP
  x = TRUE AND FALSE
  y = TRUE OR FALSE
  z = NOT TRUE
  LOG(x)
  LOG(y)
  LOG(z)
END`;
  const rt = makeRuntime(script);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(100);
  await rt.stop();
  // _addLog convierte a string antes de almacenar
  assertTrue(logs.some(m => m === 'false'), `AND: ${JSON.stringify(logs)}`);
  assertTrue(logs.some(m => m === 'true'),  `OR`);
});

test('División por cero retorna null sin lanzar', async () => {
  const rt = makeRuntime('ON STARTUP\n  x = 5 / 0\n  LOG(x)\nEND');
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'null'), `Logs: ${JSON.stringify(logs)}`);
});

test('Concatenación de strings con +', async () => {
  const rt = makeRuntime('ON STARTUP\n  LOG("hola" + " " + "mundo")\nEND');
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'hola mundo'), `Logs: ${JSON.stringify(logs)}`);
});

test('getActiveAlarms filtra alarmas no confirmadas', async () => {
  const rt = makeRuntime(`
ON STARTUP
  ALARM("alerta1", WARN)
  ALARM("alerta2", INFO)
END`);
  await rt.start();
  await sleep(100);
  await rt.stop();
  const active = rt.getActiveAlarms();
  assertEqual(active.length, 2);
  rt.ackAlarm(0);
  assertEqual(rt.getActiveAlarms().length, 1);
});

test('ON SHUTDOWN se ejecuta al detener', async () => {
  const rt = makeRuntime(`
ON STARTUP
  LOG("inicio")
END
ON SHUTDOWN
  LOG("fin")
END`);
  const logs = [];
  rt.onLog = e => logs.push(e.msg);
  await rt.start();
  await sleep(50);
  await rt.stop();
  assertTrue(logs.some(m => m === 'fin'), `Logs: ${JSON.stringify(logs)}`);
});

// ─── Resumen ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(42));
await runAll();
console.log(`\nTotal: ${passed + failed} | ✓ ${passed} pasados | ${failed > 0 ? '✗' : '✓'} ${failed} fallidos`);
if (failed > 0) process.exit(1);
