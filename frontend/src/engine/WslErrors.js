/**
 * WslErrors.js
 * Clases de error para el Lexer y Parser de WSL.
 */

export class WslLexError extends Error {
  constructor(message, line, col) {
    super(`[WSL LexError] Línea ${line}:${col} — ${message}`);
    this.name = 'WslLexError';
    this.line = line;
    this.col = col;
    this.wslMessage = message;
  }
}

export class WslParseError extends Error {
  constructor(message, line, col, tokenText = '') {
    const loc = `Línea ${line}:${col}`;
    const token = tokenText ? ` (encontrado: '${tokenText}')` : '';
    super(`[WSL ParseError] ${loc} — ${message}${token}`);
    this.name = 'WslParseError';
    this.line = line;
    this.col = col;
    this.tokenText = tokenText;
    this.wslMessage = message;
  }
}
