import { describe, expect, it } from 'vitest';
import { escapeNonMathDollars } from './dollarMath';

describe('escapeNonMathDollars', () => {
  it('leaves text without dollar signs untouched', () => {
    expect(escapeNonMathDollars('plain text')).toBe('plain text');
  });

  it('keeps dollars separated by whitespace literal', () => {
    // https://github.com/remarkjs/remark-math/issues/33
    const sentence =
      "I'd like to buy this computer, but $1,000 is really expensive, I'll buy the one at $600 instead.";
    expect(escapeNonMathDollars(sentence)).toBe(
      "I'd like to buy this computer, but \\$1,000 is really expensive, I'll buy the one at \\$600 instead."
    );
  });

  it('keeps a dollar range literal when the closing dollar is followed by a digit', () => {
    // https://github.com/micromark/micromark-extension-math/issues/6
    expect(escapeNonMathDollars('an item costs $20,000 and another one costs $30,000')).toBe(
      'an item costs \\$20,000 and another one costs \\$30,000'
    );
  });

  it('keeps unclosed dollar signs literal', () => {
    expect(escapeNonMathDollars('unclosed $x^2 stays text')).toBe('unclosed \\$x^2 stays text');
  });

  it('preserves inline math', () => {
    expect(escapeNonMathDollars('the formula $x^2$ works')).toBe('the formula $x^2$ works');
    expect(escapeNonMathDollars('$x_0 \\ge 0$ and $n$')).toBe('$x_0 \\ge 0$ and $n$');
  });

  it('preserves display math', () => {
    expect(escapeNonMathDollars('$$x^2$$')).toBe('$$x^2$$');
    expect(escapeNonMathDollars('$$\n\\frac{1}{2}\n$$')).toBe('$$\n\\frac{1}{2}\n$$');
  });

  it('preserves code spans and fenced code blocks', () => {
    expect(escapeNonMathDollars('run `echo $HOME` first')).toBe('run `echo $HOME` first');
    expect(escapeNonMathDollars('```\necho $HOME $PATH\n```')).toBe(
      '```\necho $HOME $PATH\n```'
    );
    expect(escapeNonMathDollars('~~~\n$5 and $10\n~~~')).toBe('~~~\n$5 and $10\n~~~');
  });

  it('preserves dollar signs that are already escaped', () => {
    expect(escapeNonMathDollars('literal \\$5 and \\$10')).toBe('literal \\$5 and \\$10');
  });

  it('treats shell pairs without adjacent whitespace as math, like Pandoc does', () => {
    // Known limitation; shell commands belong in code spans.
    expect(escapeNonMathDollars('PATH="$HOME/bin:$PATH"')).toBe('PATH="$HOME/bin:$PATH"');
  });
});
