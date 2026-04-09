/**
 * WslLexer.js
 * Tokenizador para el lenguaje WSL (SCADA Scripting Language).
 *
 * Uso:
 *   import { WslLexer } from './WslLexer.js';
 *   const tokens = new WslLexer(source).tokenize();
 */

import { WslLexError } from './WslErrors.js';

// ─── Tipos de token ──────────────────────────────────────────────────────────

export const TT = Object.freeze({
  // Literales
  NUMBER:     'NUMBER',
  STRING:     'STRING',
  IDENTIFIER: 'IDENTIFIER',

  // Keywords de control de flujo
  ON:       'ON',
  END:      'END',
  IF:       'IF',
  THEN:     'THEN',
  ELSE:     'ELSE',
  WHILE:    'WHILE',
  DO:       'DO',
  FOR:      'FOR',
  FROM:     'FROM',
  TO:       'TO',

  // Keywords de eventos
  STARTUP:  'STARTUP',
  SHUTDOWN: 'SHUTDOWN',
  INTERVAL: 'INTERVAL',
  CHANGE:   'CHANGE',
  CLICK:    'CLICK',

  // Keywords de valores
  TRUE:     'TRUE',
  FALSE:    'FALSE',

  // Operadores lógicos (palabras)
  AND:      'AND',
  OR:       'OR',
  NOT:      'NOT',

  // Declaración de variables
  VAR:      'VAR',

  // Comandos / funciones built-in
  SET:      'SET',
  ALARM:    'ALARM',   // doble rol: evento y comando
  LOG:      'LOG',
  NOTIFY:   'NOTIFY',
  CALL:     'CALL',
  WAIT:     'WAIT',
  READ:     'READ',
  MODE:     'MODE',
  DEVICE:   'DEVICE',
  NOW:      'NOW',

  // Operadores simbólicos
  PLUS:     'PLUS',     // +
  MINUS:    'MINUS',    // -
  STAR:     'STAR',     // *
  SLASH:    'SLASH',    // /
  EQEQ:     'EQEQ',    // ==
  NEQ:      'NEQ',      // !=
  LTE:      'LTE',      // <=
  GTE:      'GTE',      // >=
  LT:       'LT',       // <
  GT:       'GT',       // >
  EQ:       'EQ',       // =  (asignación)

  // Puntuación
  LPAREN:   'LPAREN',  // (
  RPAREN:   'RPAREN',  // )
  COMMA:    'COMMA',   // ,

  // Fin de archivo
  EOF:      'EOF',
});

// Conjunto de todas las palabras reservadas (en mayúsculas)
const KEYWORDS = new Set([
  'ON', 'END', 'IF', 'THEN', 'ELSE', 'WHILE', 'DO', 'FOR', 'FROM', 'TO',
  'STARTUP', 'SHUTDOWN', 'INTERVAL', 'CHANGE', 'CLICK',
  'TRUE', 'FALSE',
  'AND', 'OR', 'NOT',
  'VAR',
  'SET', 'ALARM', 'LOG', 'NOTIFY', 'CALL', 'WAIT', 'READ', 'MODE', 'DEVICE', 'NOW',
]);

// ─── Token ───────────────────────────────────────────────────────────────────

export class Token {
  constructor(type, value, line, col) {
    this.type  = type;
    this.value = value;
    this.line  = line;
    this.col   = col;
  }

  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
  }
}

// ─── Lexer ───────────────────────────────────────────────────────────────────

export class WslLexer {
  constructor(source) {
    this.source = source;
    this.pos    = 0;
    this.line   = 1;
    this.col    = 1;
    this.tokens = [];
  }

  tokenize() {
    while (!this._isAtEnd()) {
      this._skipWhitespaceAndComments();
      if (this._isAtEnd()) break;
      this._scanToken();
    }
    this.tokens.push(new Token(TT.EOF, null, this.line, this.col));
    return this.tokens;
  }

  // ── Helpers internos ──────────────────────────────────────────────────────

  _isAtEnd() {
    return this.pos >= this.source.length;
  }

  _peek(offset = 0) {
    return this.source[this.pos + offset] ?? '\0';
  }

  _advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') { this.line++; this.col = 1; }
    else             { this.col++; }
    return ch;
  }

  _match(expected) {
    if (this._isAtEnd() || this.source[this.pos] !== expected) return false;
    this._advance();
    return true;
  }

  _addToken(type, value) {
    // line/col ya apuntan al carácter siguiente; guardamos la posición
    // de inicio que fue pasada en cada caso. Usamos this._tokenLine/Col.
    this.tokens.push(new Token(type, value, this._tokenLine, this._tokenCol));
  }

  // ── Omitir espacios y comentarios (//) ───────────────────────────────────

  _skipWhitespaceAndComments() {
    while (!this._isAtEnd()) {
      const ch = this._peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this._advance();
      } else if (ch === '/' && this._peek(1) === '/') {
        // comentario de línea
        while (!this._isAtEnd() && this._peek() !== '\n') this._advance();
      } else {
        break;
      }
    }
  }

  // ── Escanear un token ─────────────────────────────────────────────────────

  _scanToken() {
    // Guardar posición de inicio del token
    this._tokenLine = this.line;
    this._tokenCol  = this.col;

    const ch = this._advance();

    switch (ch) {
      case '(': this._addToken(TT.LPAREN, '('); break;
      case ')': this._addToken(TT.RPAREN, ')'); break;
      case ',': this._addToken(TT.COMMA,  ','); break;
      case '+': this._addToken(TT.PLUS,   '+'); break;
      case '-': this._addToken(TT.MINUS,  '-'); break;
      case '*': this._addToken(TT.STAR,   '*'); break;
      case '/': this._addToken(TT.SLASH,  '/'); break;

      case '=':
        if (this._match('=')) this._addToken(TT.EQEQ, '==');
        else                   this._addToken(TT.EQ,   '=');
        break;

      case '!':
        if (this._match('=')) this._addToken(TT.NEQ, '!=');
        else throw new WslLexError(`Carácter inesperado '!', ¿quiso decir '!='?`, this._tokenLine, this._tokenCol);
        break;

      case '<':
        if (this._match('=')) this._addToken(TT.LTE, '<=');
        else                   this._addToken(TT.LT,  '<');
        break;

      case '>':
        if (this._match('=')) this._addToken(TT.GTE, '>=');
        else                   this._addToken(TT.GT,  '>');
        break;

      case '"':
        this._scanString();
        break;

      default:
        if (this._isDigit(ch))  { this._scanNumber(ch);     break; }
        if (this._isAlpha(ch))  { this._scanIdentifier(ch); break; }
        throw new WslLexError(
          `Carácter inesperado '${ch}'`,
          this._tokenLine, this._tokenCol
        );
    }
  }

  // ── String literal ────────────────────────────────────────────────────────

  _scanString() {
    let value = '';
    while (!this._isAtEnd() && this._peek() !== '"') {
      if (this._peek() === '\n') {
        throw new WslLexError(
          'String no terminado (salto de línea antes del cierre ")',
          this._tokenLine, this._tokenCol
        );
      }
      value += this._advance();
    }
    if (this._isAtEnd()) {
      throw new WslLexError(
        'String no terminado (se llegó al fin del archivo)',
        this._tokenLine, this._tokenCol
      );
    }
    this._advance(); // consume el '"' de cierre
    this._addToken(TT.STRING, value);
  }

  // ── Número ────────────────────────────────────────────────────────────────

  _scanNumber(firstChar) {
    let raw = firstChar;
    while (this._isDigit(this._peek())) raw += this._advance();

    if (this._peek() === '.' && this._isDigit(this._peek(1))) {
      raw += this._advance(); // consume '.'
      while (this._isDigit(this._peek())) raw += this._advance();
    }

    this._addToken(TT.NUMBER, parseFloat(raw));
  }

  // ── Identificador / keyword ───────────────────────────────────────────────

  _scanIdentifier(firstChar) {
    let raw = firstChar;
    // Permite letras, dígitos, guion bajo y punto (para obj.PROP)
    while (this._isIdentChar(this._peek())) raw += this._advance();

    // Solo reconocer como keyword si el token completo (sin parte de punto) coincide exactamente
    // Las keywords son siempre mayúsculas exactas y no contienen punto
    const type = (!raw.includes('.') && KEYWORDS.has(raw)) ? raw : TT.IDENTIFIER;
    this._addToken(type, raw);
  }

  // ── Clasificadores de caracteres ──────────────────────────────────────────

  _isDigit(ch)      { return ch >= '0' && ch <= '9'; }
  _isAlpha(ch)      { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'; }
  _isAlphaNumeric(ch) { return this._isAlpha(ch) || this._isDigit(ch); }
  // Caracteres válidos dentro de un identifier (incluye punto para obj.PROP)
  _isIdentChar(ch)  { return this._isAlphaNumeric(ch) || ch === '.'; }
}
