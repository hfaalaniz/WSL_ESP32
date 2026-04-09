/**
 * WslParser.js
 * Parser de WSL — produce un AST a partir del código fuente.
 *
 * Soporta:
 *   - VAR nombre [= expr]         declaración de variable (global o local)
 *   - SET(obj.ACCION)             activar acción dot-notation (sin segundo arg)
 *   - SET("tag", valor)           escritura clásica de tag
 *   - Error recovery: reporta todos los errores en lugar de detenerse en el primero
 */

import { WslLexer, TT } from './WslLexer.js';
import { WslParseError }  from './WslErrors.js';

// Niveles de alarma válidos
const ALARM_LEVELS = new Set(['INFO', 'WARN', 'CRITICAL']);

// Unidades de tiempo válidas para ON INTERVAL
const TIME_UNITS = new Set(['s', 'm', 'h', 'S', 'M', 'H']);

// ─── Parser ──────────────────────────────────────────────────────────────────

export class WslParser {
  /**
   * @param {string} source  Código fuente WSL
   */
  constructor(source) {
    this.tokens = new WslLexer(source).tokenize();
    this.pos    = 0;
    // Lista de errores acumulados (error recovery)
    this.errors = [];
  }

  // ── API pública ───────────────────────────────────────────────────────────

  /**
   * Parsea el código y retorna el AST raíz (nodo Program).
   * Con error recovery: intenta continuar después de cada error.
   * @returns {ProgramNode}
   */
  parse() {
    const vars   = [];  // Variables globales (VAR fuera de ON)
    const events = [];

    while (!this._isAtEnd()) {
      try {
        if (this._check(TT.VAR)) {
          vars.push(this._parseVarDecl());
        } else {
          events.push(this._parseEventBlock());
        }
      } catch (e) {
        if (e instanceof WslParseError) {
          this.errors.push(e);
          // Error recovery: avanzar hasta el próximo ON, VAR o EOF
          this._syncToNextBlock();
        } else {
          throw e; // Error inesperado — re-lanzar
        }
      }
    }

    // Si hubo errores, lanzar el primero (para compatibilidad con WslValidator)
    // pero adjuntar todos los demás al error
    if (this.errors.length > 0) {
      const first = this.errors[0];
      first.allErrors = this.errors;
      throw first;
    }

    return { type: 'Program', vars, events };
  }

  /**
   * Avanza hasta el próximo token ON, VAR o EOF para recuperarse de un error.
   */
  _syncToNextBlock() {
    while (!this._isAtEnd()) {
      const t = this._peek();
      if (t.type === TT.ON || t.type === TT.VAR) return;
      this._advance();
    }
  }

  // ── Helpers de cursor ─────────────────────────────────────────────────────

  _peek()        { return this.tokens[this.pos]; }
  _peekNext()    { return this.tokens[this.pos + 1]; }
  _previous()    { return this.tokens[this.pos - 1]; }
  _isAtEnd()     { return this._peek().type === TT.EOF; }

  _advance() {
    if (!this._isAtEnd()) this.pos++;
    return this._previous();
  }

  _check(type) {
    return this._peek().type === type;
  }

  _match(...types) {
    for (const t of types) {
      if (this._check(t)) { this._advance(); return true; }
    }
    return false;
  }

  /**
   * Consume el token esperado o lanza WslParseError.
   */
  _expect(type, message) {
    if (this._check(type)) return this._advance();
    const tok = this._peek();
    throw new WslParseError(message, tok.line, tok.col, tok.value ?? tok.type);
  }

  _errorAt(token, message) {
    throw new WslParseError(message, token.line, token.col, token.value ?? token.type);
  }

  // ── Declaración de variable ───────────────────────────────────────────────

  /**
   * VAR nombre [= expr]
   */
  _parseVarDecl() {
    const tok = this._advance(); // consume VAR
    const nameTok = this._expect(TT.IDENTIFIER, "Se esperaba el nombre de la variable después de VAR");

    let init = null;
    if (this._match(TT.EQ)) {
      init = this._parseExpression();
    }

    return {
      type: 'VarDeclaration',
      name: nameTok.value,
      init,
      line: tok.line,
      col:  tok.col,
    };
  }

  // ── Bloque de evento ──────────────────────────────────────────────────────

  /**
   * ON <evento> [args]
   *   ...statements...
   * END
   */
  _parseEventBlock() {
    const onTok = this._expect(TT.ON, "Se esperaba 'ON' al inicio de un bloque de evento");

    const event = this._parseEventDescriptor(onTok);

    const body = this._parseStatementList('END', 'ELSE');
    this._expect(TT.END, `Se esperaba 'END' para cerrar el bloque ON ${event.kind} (línea ${onTok.line})`);

    return { type: 'EventBlock', event, body, line: onTok.line, col: onTok.col };
  }

  _parseEventDescriptor(onTok) {
    const tok = this._advance();

    switch (tok.type) {
      case TT.STARTUP:
        return { kind: 'STARTUP', line: tok.line, col: tok.col };

      case TT.SHUTDOWN:
        return { kind: 'SHUTDOWN', line: tok.line, col: tok.col };

      case TT.INTERVAL: {
        // ON INTERVAL 5s  |  ON INTERVAL 10m  |  ON INTERVAL 1h
        const numTok  = this._expect(TT.NUMBER, "ON INTERVAL requiere un número (ej: 5s, 10m, 1h)");
        const unitTok = this._expect(TT.IDENTIFIER, "ON INTERVAL requiere una unidad de tiempo: s, m, h");
        if (!TIME_UNITS.has(unitTok.value)) {
          this._errorAt(unitTok, `Unidad de tiempo inválida '${unitTok.value}' — use s, m, o h`);
        }
        return {
          kind:  'INTERVAL',
          value: numTok.value,
          unit:  unitTok.value.toLowerCase(),
          line:  tok.line, col: tok.col,
        };
      }

      case TT.CHANGE: {
        // ON CHANGE "tag.name"
        const tagTok = this._expect(TT.STRING, "ON CHANGE requiere el nombre del tag entre comillas");
        return { kind: 'CHANGE', tag: tagTok.value, line: tok.line, col: tok.col };
      }

      case TT.CLICK: {
        // ON CLICK "obj-id"
        const objTok = this._expect(TT.STRING, "ON CLICK requiere el ID del objeto entre comillas");
        return { kind: 'CLICK', objectId: objTok.value, line: tok.line, col: tok.col };
      }

      case TT.ALARM: {
        // ON ALARM "tag.name"
        const alarmTagTok = this._expect(TT.STRING, "ON ALARM requiere el nombre del tag entre comillas");
        return { kind: 'ALARM', tag: alarmTagTok.value, line: tok.line, col: tok.col };
      }

      default:
        this._errorAt(tok,
          `Tipo de evento desconocido '${tok.value}' — se esperaba STARTUP, SHUTDOWN, INTERVAL, CHANGE, CLICK o ALARM`
        );
    }
  }

  // ── Lista de sentencias ───────────────────────────────────────────────────

  /**
   * Parsea sentencias hasta encontrar alguno de los tokens de parada.
   * @param {...string} stopTypes  Tipos de token que detienen la lista
   */
  _parseStatementList(...stopTypes) {
    const statements = [];
    while (!this._isAtEnd() && !stopTypes.some(t => this._check(TT[t] ?? t))) {
      try {
        statements.push(this._parseStatement());
      } catch (e) {
        if (e instanceof WslParseError) {
          this.errors.push(e);
          // Recuperar dentro del bloque: avanzar hasta una sentencia conocida o END
          this._syncToNextStatement(stopTypes);
        } else {
          throw e;
        }
      }
    }
    return statements;
  }

  /**
   * Avanza hasta la próxima sentencia reconocible o un token de parada.
   */
  _syncToNextStatement(stopTypes) {
    const stmtStarters = new Set([
      TT.IF, TT.WHILE, TT.FOR, TT.SET, TT.ALARM, TT.LOG,
      TT.NOTIFY, TT.CALL, TT.WAIT, TT.VAR, TT.END,
    ]);
    while (!this._isAtEnd()) {
      const t = this._peek();
      if (stmtStarters.has(t.type)) return;
      if (stopTypes.some(s => t.type === (TT[s] ?? s))) return;
      if (t.type === TT.IDENTIFIER && this.tokens[this.pos + 1]?.type === TT.EQ) return;
      this._advance();
    }
  }

  // ── Sentencias ────────────────────────────────────────────────────────────

  _parseStatement() {
    const tok = this._peek();

    switch (tok.type) {
      case TT.VAR:    return this._parseVarDecl();
      case TT.IF:     return this._parseIf();
      case TT.WHILE:  return this._parseWhile();
      case TT.FOR:    return this._parseFor();
      case TT.SET:    return this._parseSet();
      case TT.ALARM:  return this._parseAlarm();
      case TT.LOG:    return this._parseLog();
      case TT.NOTIFY: return this._parseNotify();
      case TT.CALL:   return this._parseCall();
      case TT.WAIT:   return this._parseWait();

      case TT.IDENTIFIER:
        // Puede ser asignación: varname = expr
        if (this._peekNext().type === TT.EQ) return this._parseAssignment();
        this._errorAt(tok,
          `Sentencia inválida '${tok.value}' — ¿falta el '=' para asignar?`
        );
        break;

      default:
        this._errorAt(tok,
          `Se esperaba una sentencia (VAR, SET, LOG, NOTIFY, CALL, WAIT, ALARM, IF, WHILE, FOR, o asignación), ` +
          `pero se encontró '${tok.value ?? tok.type}'`
        );
    }
  }

  // IF <cond> THEN ... [ELSE ...] END
  _parseIf() {
    const tok = this._advance(); // consume IF
    const condition = this._parseExpression();
    this._expect(TT.THEN, "Se esperaba 'THEN' después de la condición del IF");

    const consequent = this._parseStatementList('ELSE', 'END');

    let alternate = [];
    if (this._match(TT.ELSE)) {
      alternate = this._parseStatementList('END');
    }

    this._expect(TT.END, `Se esperaba 'END' para cerrar el IF (línea ${tok.line})`);
    return { type: 'IfStatement', condition, consequent, alternate, line: tok.line, col: tok.col };
  }

  // WHILE <cond> DO ... END
  _parseWhile() {
    const tok = this._advance(); // consume WHILE
    const condition = this._parseExpression();
    this._expect(TT.DO, "Se esperaba 'DO' después de la condición del WHILE");
    const body = this._parseStatementList('END');
    this._expect(TT.END, `Se esperaba 'END' para cerrar el WHILE (línea ${tok.line})`);
    return { type: 'WhileStatement', condition, body, line: tok.line, col: tok.col };
  }

  // FOR <var> FROM <expr> TO <expr> ... END
  _parseFor() {
    const tok = this._advance(); // consume FOR
    const varTok = this._expect(TT.IDENTIFIER, "Se esperaba el nombre de la variable del FOR");
    this._expect(TT.FROM, "Se esperaba 'FROM' en el FOR");
    const from = this._parseExpression();
    this._expect(TT.TO, "Se esperaba 'TO' en el FOR");
    const to = this._parseExpression();
    const body = this._parseStatementList('END');
    this._expect(TT.END, `Se esperaba 'END' para cerrar el FOR (línea ${tok.line})`);
    return {
      type: 'ForStatement',
      variable: varTok.value,
      from, to, body,
      line: tok.line, col: tok.col,
    };
  }

  /**
   * SET tiene dos formas:
   *   SET(obj.ACCION)          — dot-action: activa acción en objeto SCADA
   *   SET("tag", valor)        — escritura clásica de tag
   *   SET(variable, valor)     — asignación de variable (sin comillas)
   */
  _parseSet() {
    const tok = this._advance(); // consume SET
    this._expect(TT.LPAREN, "Se esperaba '(' después de SET");

    // Leer primer argumento
    const firstTok = this._peek();

    // Forma dot-action: SET(Identificador.ACCION) — el lexer produce un único IDENTIFIER con punto
    if (firstTok.type === TT.IDENTIFIER && firstTok.value.includes('.')) {
      const dotTok = this._advance();
      const dotIdx = dotTok.value.lastIndexOf('.');
      const objLabel = dotTok.value.slice(0, dotIdx);
      const action   = dotTok.value.slice(dotIdx + 1);
      this._expect(TT.RPAREN, "Se esperaba ')' para cerrar SET");
      return {
        type:   'SetActionStatement',
        object: objLabel,
        action: action.toUpperCase(),
        line:   tok.line,
        col:    tok.col,
      };
    }

    // Forma clásica: SET("tag", valor) o SET(variable, valor)
    let tagExpr;
    if (firstTok.type === TT.STRING) {
      this._advance();
      tagExpr = { type: 'StringLiteral', value: firstTok.value, line: firstTok.line, col: firstTok.col };
    } else {
      tagExpr = this._parseExpression();
    }

    this._expect(TT.COMMA, "Se esperaba ',' entre los argumentos de SET, o 'Objeto.ACCION' para dot-action");
    const value = this._parseExpression();
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar SET");
    return { type: 'SetStatement', tag: tagExpr.value ?? tagExpr, value, line: tok.line, col: tok.col };
  }

  // ALARM("mensaje", NIVEL)
  _parseAlarm() {
    const tok = this._advance(); // consume ALARM
    this._expect(TT.LPAREN, "Se esperaba '(' después de ALARM");
    const msgTok = this._expect(TT.STRING, "ALARM requiere el mensaje entre comillas como primer argumento");
    this._expect(TT.COMMA, "Se esperaba ',' entre los argumentos de ALARM");
    // Nivel: INFO, WARN, CRITICAL — se ven como IDENTIFIER o keyword
    const levelTok = this._advance();
    const level = levelTok.value?.toString().toUpperCase();
    if (!ALARM_LEVELS.has(level)) {
      this._errorAt(levelTok, `Nivel de alarma inválido '${levelTok.value}' — use INFO, WARN o CRITICAL`);
    }
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar ALARM");
    return { type: 'AlarmStatement', message: msgTok.value, level, line: tok.line, col: tok.col };
  }

  // LOG("mensaje")
  _parseLog() {
    const tok = this._advance(); // consume LOG
    this._expect(TT.LPAREN, "Se esperaba '(' después de LOG");
    const message = this._parseExpression();
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar LOG");
    return { type: 'LogStatement', message, line: tok.line, col: tok.col };
  }

  // NOTIFY("mensaje")
  _parseNotify() {
    const tok = this._advance(); // consume NOTIFY
    this._expect(TT.LPAREN, "Se esperaba '(' después de NOTIFY");
    const message = this._parseExpression();
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar NOTIFY");
    return { type: 'NotifyStatement', message, line: tok.line, col: tok.col };
  }

  // CALL("endpoint", payload)
  _parseCall() {
    const tok = this._advance(); // consume CALL
    this._expect(TT.LPAREN, "Se esperaba '(' después de CALL");
    const endpoint = this._parseExpression();
    this._expect(TT.COMMA, "Se esperaba ',' entre los argumentos de CALL");
    const payload = this._parseExpression();
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar CALL");
    return { type: 'CallStatement', endpoint, payload, line: tok.line, col: tok.col };
  }

  // WAIT(ms)
  _parseWait() {
    const tok = this._advance(); // consume WAIT
    this._expect(TT.LPAREN, "Se esperaba '(' después de WAIT");
    const duration = this._parseExpression();
    this._expect(TT.RPAREN, "Se esperaba ')' para cerrar WAIT");
    return { type: 'WaitStatement', duration, line: tok.line, col: tok.col };
  }

  // variable = expresión
  _parseAssignment() {
    const varTok = this._advance();   // consume IDENTIFIER
    this._advance();                  // consume =
    const value = this._parseExpression();
    return { type: 'AssignStatement', name: varTok.value, value, line: varTok.line, col: varTok.col };
  }

  // ── Expresiones (precedencia ascendente) ──────────────────────────────────

  _parseExpression() { return this._parseOr(); }

  // OR (menor precedencia)
  _parseOr() {
    let left = this._parseAnd();
    while (this._check(TT.OR)) {
      const op = this._advance();
      const right = this._parseAnd();
      left = { type: 'BinaryExpression', operator: 'OR', left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // AND
  _parseAnd() {
    let left = this._parseNot();
    while (this._check(TT.AND)) {
      const op = this._advance();
      const right = this._parseNot();
      left = { type: 'BinaryExpression', operator: 'AND', left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // NOT (unario prefijo)
  _parseNot() {
    if (this._check(TT.NOT)) {
      const op = this._advance();
      const operand = this._parseNot(); // permite NOT NOT x
      return { type: 'UnaryExpression', operator: 'NOT', operand, line: op.line, col: op.col };
    }
    return this._parseComparison();
  }

  // Comparaciones: == != < > <= >=
  _parseComparison() {
    let left = this._parseAddSub();
    const compOps = [TT.EQEQ, TT.NEQ, TT.LT, TT.GT, TT.LTE, TT.GTE];
    while (compOps.some(t => this._check(t))) {
      const op = this._advance();
      const right = this._parseAddSub();
      left = { type: 'BinaryExpression', operator: op.value, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // + y -
  _parseAddSub() {
    let left = this._parseMulDiv();
    while (this._check(TT.PLUS) || this._check(TT.MINUS)) {
      const op = this._advance();
      const right = this._parseMulDiv();
      left = { type: 'BinaryExpression', operator: op.value, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // * y /
  _parseMulDiv() {
    let left = this._parseUnary();
    while (this._check(TT.STAR) || this._check(TT.SLASH)) {
      const op = this._advance();
      const right = this._parseUnary();
      left = { type: 'BinaryExpression', operator: op.value, left, right, line: op.line, col: op.col };
    }
    return left;
  }

  // Unario -
  _parseUnary() {
    if (this._check(TT.MINUS)) {
      const op = this._advance();
      const operand = this._parsePrimary();
      return { type: 'UnaryExpression', operator: '-', operand, line: op.line, col: op.col };
    }
    return this._parsePrimary();
  }

  // Primarios: literales, variables, llamadas built-in, (expr)
  _parsePrimary() {
    const tok = this._peek();

    // Literales numéricos
    if (tok.type === TT.NUMBER) {
      this._advance();
      return { type: 'NumberLiteral', value: tok.value, line: tok.line, col: tok.col };
    }

    // Literales string
    if (tok.type === TT.STRING) {
      this._advance();
      return { type: 'StringLiteral', value: tok.value, line: tok.line, col: tok.col };
    }

    // TRUE / FALSE
    if (tok.type === TT.TRUE) {
      this._advance();
      return { type: 'BooleanLiteral', value: true, line: tok.line, col: tok.col };
    }
    if (tok.type === TT.FALSE) {
      this._advance();
      return { type: 'BooleanLiteral', value: false, line: tok.line, col: tok.col };
    }

    // Variable (identificador) — puede ser obj.PROP (ya incluye el punto)
    if (tok.type === TT.IDENTIFIER) {
      this._advance();
      return { type: 'Identifier', name: tok.value, line: tok.line, col: tok.col };
    }

    // Expresión parentizada
    if (tok.type === TT.LPAREN) {
      this._advance();
      const expr = this._parseExpression();
      this._expect(TT.RPAREN, "Se esperaba ')' para cerrar la expresión parentizada");
      return expr;
    }

    // ── Funciones built-in (como expresiones) ────────────────────────────

    // READ("tag")
    if (tok.type === TT.READ) {
      this._advance();
      this._expect(TT.LPAREN, "Se esperaba '(' después de READ");
      const tagTok = this._expect(TT.STRING, "READ requiere el nombre del tag entre comillas");
      this._expect(TT.RPAREN, "Se esperaba ')' para cerrar READ");
      return { type: 'ReadCall', tag: tagTok.value, line: tok.line, col: tok.col };
    }

    // NOW  /  NOW()   — paréntesis opcionales
    if (tok.type === TT.NOW) {
      this._advance();
      if (this._check(TT.LPAREN)) {
        this._advance();                                      // consume '('
        this._expect(TT.RPAREN, "Se esperaba ')' para cerrar NOW()");
      }
      return { type: 'NowCall', line: tok.line, col: tok.col };
    }

    // MODE  /  MODE()  — paréntesis opcionales
    if (tok.type === TT.MODE) {
      this._advance();
      if (this._check(TT.LPAREN)) {
        this._advance();
        this._expect(TT.RPAREN, "Se esperaba ')' para cerrar MODE()");
      }
      return { type: 'ModeCall', line: tok.line, col: tok.col };
    }

    // DEVICE  /  DEVICE()  — paréntesis opcionales
    if (tok.type === TT.DEVICE) {
      this._advance();
      if (this._check(TT.LPAREN)) {
        this._advance();
        this._expect(TT.RPAREN, "Se esperaba ')' para cerrar DEVICE()");
      }
      return { type: 'DeviceCall', line: tok.line, col: tok.col };
    }

    this._errorAt(tok,
      `Se esperaba una expresión (número, string, TRUE/FALSE, variable, READ, MODE, DEVICE, NOW o expresión entre paréntesis)`
    );
  }
}
