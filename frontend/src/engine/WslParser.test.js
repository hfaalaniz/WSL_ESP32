/**
 * WslParser.test.js
 * Tests unitarios para WslLexer y WslParser.
 * Ejecutar con: node --experimental-vm-modules WslParser.test.js
 * (o con Vitest / Jest con soporte ESM)
 */

import { WslLexer, TT } from './WslLexer.js';
import { WslParser }    from './WslParser.js';
import { WslLexError, WslParseError } from './WslErrors.js';

// ─── Mini framework de test ───────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n    Esperado: ${b}\n    Obtenido: ${a}`);
}

function assertThrows(fn, errorClass, msgFragment = '') {
  try {
    fn();
    throw new Error(`Se esperaba que lanzara ${errorClass.name} pero no lanzó`);
  } catch (e) {
    if (!(e instanceof errorClass)) {
      throw new Error(`Se esperaba ${errorClass.name} pero se obtuvo ${e.constructor.name}: ${e.message}`);
    }
    if (msgFragment && !e.message.includes(msgFragment)) {
      throw new Error(`Error lanzado, pero el mensaje no contiene '${msgFragment}'.\nMensaje: ${e.message}`);
    }
  }
}

// ─── Tests del Lexer ──────────────────────────────────────────────────────────

console.log('\n=== LEXER ===');

test('Tokeniza números enteros y flotantes', () => {
  const tokens = new WslLexer('42 3.14').tokenize();
  assertEqual(tokens[0].type,  TT.NUMBER);
  assertEqual(tokens[0].value, 42);
  assertEqual(tokens[1].type,  TT.NUMBER);
  assertEqual(tokens[1].value, 3.14);
});

test('Tokeniza strings dobles', () => {
  const tokens = new WslLexer('"hola mundo"').tokenize();
  assertEqual(tokens[0].type,  TT.STRING);
  assertEqual(tokens[0].value, 'hola mundo');
});

test('Tokeniza keywords correctamente', () => {
  const tokens = new WslLexer('ON STARTUP END').tokenize();
  assertEqual(tokens[0].type, TT.ON);
  assertEqual(tokens[1].type, TT.STARTUP);
  assertEqual(tokens[2].type, TT.END);
});

test('Keyword case-insensitive', () => {
  const tokens = new WslLexer('on startup end').tokenize();
  assertEqual(tokens[0].type, TT.ON);
  assertEqual(tokens[1].type, TT.STARTUP);
  assertEqual(tokens[2].type, TT.END);
});

test('Tokeniza operadores compuestos', () => {
  const src = '== != <= >= < >';
  const types = new WslLexer(src).tokenize().map(t => t.type).slice(0, -1); // sin EOF
  assertEqual(types, [TT.EQEQ, TT.NEQ, TT.LTE, TT.GTE, TT.LT, TT.GT]);
});

test('Distingue = de ==', () => {
  const tokens = new WslLexer('x = 1').tokenize();
  assertEqual(tokens[1].type, TT.EQ);
});

test('Omite comentarios de línea', () => {
  const tokens = new WslLexer('// esto es un comentario\n42').tokenize();
  assertEqual(tokens[0].type,  TT.NUMBER);
  assertEqual(tokens[0].value, 42);
});

test('Trackea líneas y columnas', () => {
  const tokens = new WslLexer('ON\nSTARTUP').tokenize();
  assertEqual(tokens[0].line, 1);
  assertEqual(tokens[1].line, 2);
});

test('Lanza WslLexError en string no terminado', () => {
  assertThrows(() => new WslLexer('"sin cerrar').tokenize(), WslLexError, 'no terminado');
});

test('Lanza WslLexError en carácter inválido', () => {
  assertThrows(() => new WslLexer('@').tokenize(), WslLexError, 'inesperado');
});

test('Lanza WslLexError en ! solitario', () => {
  assertThrows(() => new WslLexer('!x').tokenize(), WslLexError, "!='");
});

// ─── Tests del Parser ─────────────────────────────────────────────────────────

console.log('\n=== PARSER ===');

test('Parsea ON STARTUP vacío', () => {
  const ast = new WslParser('ON STARTUP END').parse();
  assertEqual(ast.type, 'Program');
  assertEqual(ast.events.length, 1);
  assertEqual(ast.events[0].event.kind, 'STARTUP');
  assertEqual(ast.events[0].body.length, 0);
});

test('Parsea ON SHUTDOWN', () => {
  const ast = new WslParser('ON SHUTDOWN END').parse();
  assertEqual(ast.events[0].event.kind, 'SHUTDOWN');
});

test('Parsea ON INTERVAL con unidades', () => {
  for (const [src, unit] of [['5s', 's'], ['10m', 'm'], ['1h', 'h']]) {
    const ast = new WslParser(`ON INTERVAL ${src} END`).parse();
    const ev  = ast.events[0].event;
    assertEqual(ev.kind, 'INTERVAL');
    assertEqual(ev.unit, unit);
  }
});

test('Parsea ON CHANGE "tag"', () => {
  const ast = new WslParser('ON CHANGE "esp01.din.gpio2" END').parse();
  assertEqual(ast.events[0].event.kind, 'CHANGE');
  assertEqual(ast.events[0].event.tag,  'esp01.din.gpio2');
});

test('Parsea ON CLICK "obj-id"', () => {
  const ast = new WslParser('ON CLICK "boton1" END').parse();
  assertEqual(ast.events[0].event.kind,     'CLICK');
  assertEqual(ast.events[0].event.objectId, 'boton1');
});

test('Parsea ON ALARM "tag"', () => {
  const ast = new WslParser('ON ALARM "esp01.ain.adc0" END').parse();
  assertEqual(ast.events[0].event.kind, 'ALARM');
  assertEqual(ast.events[0].event.tag,  'esp01.ain.adc0');
});

test('Parsea LOG con string', () => {
  const ast = new WslParser('ON STARTUP\n  LOG("arrancando")\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'LogStatement');
  assertEqual(stmt.message.type,  'StringLiteral');
  assertEqual(stmt.message.value, 'arrancando');
});

test('Parsea LOG con expresión READ', () => {
  const ast  = new WslParser('ON STARTUP\n  LOG(READ("esp01.ain.adc0"))\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.message.type, 'ReadCall');
  assertEqual(stmt.message.tag,  'esp01.ain.adc0');
});

test('Parsea SET("tag", valor)', () => {
  const ast  = new WslParser('ON STARTUP\n  SET("esp01.dout.gpio5", TRUE)\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'SetStatement');
  assertEqual(stmt.tag,  'esp01.dout.gpio5');
  assertEqual(stmt.value.type,  'BooleanLiteral');
  assertEqual(stmt.value.value, true);
});

test('Parsea ALARM("msg", WARN)', () => {
  const ast  = new WslParser('ON STARTUP\n  ALARM("sobrecarga", WARN)\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type,    'AlarmStatement');
  assertEqual(stmt.message, 'sobrecarga');
  assertEqual(stmt.level,   'WARN');
});

test('Parsea NOTIFY("msg")', () => {
  const ast  = new WslParser('ON STARTUP\n  NOTIFY("Sistema OK")\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'NotifyStatement');
});

test('Parsea WAIT(1000)', () => {
  const ast  = new WslParser('ON STARTUP\n  WAIT(1000)\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type,             'WaitStatement');
  assertEqual(stmt.duration.value,   1000);
});

test('Parsea CALL("endpoint", payload)', () => {
  const ast  = new WslParser('ON STARTUP\n  CALL("/api/ping", 0)\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'CallStatement');
  assertEqual(stmt.endpoint.value, '/api/ping');
});

test('Parsea asignación de variable', () => {
  const ast  = new WslParser('ON STARTUP\n  temperatura = READ("esp01.ain.adc0")\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'AssignStatement');
  assertEqual(stmt.name, 'temperatura');
  assertEqual(stmt.value.type, 'ReadCall');
});

test('Parsea IF / THEN / ELSE / END', () => {
  const src = `
ON STARTUP
  IF temperatura > 80 THEN
    ALARM("Temperatura alta", CRITICAL)
  ELSE
    LOG("OK")
  END
END`;
  const ast  = new WslParser(src).parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'IfStatement');
  assertEqual(stmt.condition.type, 'BinaryExpression');
  assertEqual(stmt.condition.operator, '>');
  assertEqual(stmt.consequent.length, 1);
  assertEqual(stmt.alternate.length,  1);
});

test('Parsea IF sin ELSE', () => {
  const ast  = new WslParser('ON STARTUP\n  IF TRUE THEN\n    LOG("si")\n  END\nEND').parse();
  const stmt = ast.events[0].body[0];
  assertEqual(stmt.type, 'IfStatement');
  assertEqual(stmt.alternate.length, 0);
});

test('Parsea WHILE / DO / END', () => {
  const src = `
ON STARTUP
  contador = 0
  WHILE contador < 5 DO
    contador = contador + 1
  END
END`;
  const ast  = new WslParser(src).parse();
  const whileStmt = ast.events[0].body[1];
  assertEqual(whileStmt.type, 'WhileStatement');
  assertEqual(whileStmt.body.length, 1);
});

test('Parsea FOR / FROM / TO / END', () => {
  const src = `
ON STARTUP
  FOR i FROM 1 TO 10
    LOG("tick")
  END
END`;
  const ast  = new WslParser(src).parse();
  const forStmt = ast.events[0].body[0];
  assertEqual(forStmt.type,          'ForStatement');
  assertEqual(forStmt.variable,      'i');
  assertEqual(forStmt.from.value,    1);
  assertEqual(forStmt.to.value,      10);
});

test('Parsea precedencia aritmética correctamente', () => {
  // 2 + 3 * 4 → BinaryExpr(+, 2, BinaryExpr(*, 3, 4))
  const ast  = new WslParser('ON STARTUP\n  x = 2 + 3 * 4\nEND').parse();
  const expr = ast.events[0].body[0].value;
  assertEqual(expr.type,       'BinaryExpression');
  assertEqual(expr.operator,   '+');
  assertEqual(expr.left.value, 2);
  assertEqual(expr.right.type, 'BinaryExpression');
  assertEqual(expr.right.operator, '*');
});

test('Parsea NOT lógico', () => {
  const ast  = new WslParser('ON STARTUP\n  x = NOT TRUE\nEND').parse();
  const expr = ast.events[0].body[0].value;
  assertEqual(expr.type,     'UnaryExpression');
  assertEqual(expr.operator, 'NOT');
});

test('Parsea unario negativo', () => {
  const ast  = new WslParser('ON STARTUP\n  x = -42\nEND').parse();
  const expr = ast.events[0].body[0].value;
  assertEqual(expr.type,     'UnaryExpression');
  assertEqual(expr.operator, '-');
  assertEqual(expr.operand.value, 42);
});

test('Parsea MODE() y DEVICE()', () => {
  const src = `
ON STARTUP
  modo = MODE()
  disp = DEVICE()
END`;
  const ast = new WslParser(src).parse();
  assertEqual(ast.events[0].body[0].value.type, 'ModeCall');
  assertEqual(ast.events[0].body[1].value.type, 'DeviceCall');
});

test('Parsea NOW()', () => {
  const ast  = new WslParser('ON STARTUP\n  t = NOW()\nEND').parse();
  const expr = ast.events[0].body[0].value;
  assertEqual(expr.type, 'NowCall');
});

test('Parsea múltiples eventos', () => {
  const src = `
ON STARTUP
  LOG("inicio")
END
ON INTERVAL 5s
  SET("esp01.dout.gpio2", FALSE)
END`;
  const ast = new WslParser(src).parse();
  assertEqual(ast.events.length, 2);
  assertEqual(ast.events[0].event.kind, 'STARTUP');
  assertEqual(ast.events[1].event.kind, 'INTERVAL');
});

// ── Errores esperados ──────────────────────────────────────────────────────

console.log('\n=== ERRORES ESPERADOS ===');

test('Error: ON sin tipo de evento', () => {
  assertThrows(() => new WslParser('ON 42 END').parse(), WslParseError, 'desconocido');
});

test('Error: ON INTERVAL sin unidad válida', () => {
  assertThrows(() => new WslParser('ON INTERVAL 5x END').parse(), WslParseError, 'inválida');
});

test('Error: ALARM con nivel inválido', () => {
  assertThrows(
    () => new WslParser('ON STARTUP\n  ALARM("msg", BAJO)\nEND').parse(),
    WslParseError, 'inválido'
  );
});

test('Error: IF sin THEN', () => {
  assertThrows(
    () => new WslParser('ON STARTUP\n  IF TRUE\n    LOG("x")\n  END\nEND').parse(),
    WslParseError, 'THEN'
  );
});

test('Error: bloque sin END', () => {
  assertThrows(
    () => new WslParser('ON STARTUP\n  LOG("x")\n').parse(),
    WslParseError, 'END'
  );
});

test('Error: SET con tag no-string', () => {
  assertThrows(
    () => new WslParser('ON STARTUP\n  SET(miVariable, 1)\nEND').parse(),
    WslParseError, 'comillas'
  );
});

test('Error: identificador sin asignación', () => {
  assertThrows(
    () => new WslParser('ON STARTUP\n  mivariable\nEND').parse(),
    WslParseError, "'='"
  );
});

// ─── Resumen ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Total: ${passed + failed} | ✓ ${passed} pasados | ${failed > 0 ? '✗' : '✓'} ${failed} fallidos`);
if (failed > 0) process.exit(1);
