/**
 * Single-dollar math preprocessing
 *
 * `remark-math` pairs *any* two dollar signs, so ordinary prose such as
 * `$PATH`, `costs $5 and $10` or `$5-$10` gets swallowed into a math node and
 * silently mangled (`5 i ` renders as italic `5i`). Requiring `$$...$$` for
 * every formula avoids that, but none of the usual Markdown math dialects
 * (Pandoc, GitHub, markdown-it-katex) need it: they disambiguate with a few
 * cheap rules, and we do the same here:
 *
 *  - the opening `$` must not be followed by whitespace,
 *  - the closing `$` must not be preceded by whitespace,
 *  - the closing `$` must not be followed by a digit.
 *
 * Pairs that fail those rules are escaped with a backslash, which Markdown
 * renders as a literal `$`. Display math (`$$...$$`), code spans and fenced
 * code blocks are left untouched, and dollars that are already escaped
 * (`\$`) are preserved as written.
 */

/** Fenced code blocks and code spans; `$` inside them must stay verbatim. */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`)/g;

/** `$$...$$`, inline or block: remark-math handles these unambiguously. */
const DISPLAY_MATH = /\$\$[\s\S]*?\$\$/g;

/**
 * A dollar pair that looks like math: no whitespace on the inside of either
 * delimiter, and no digit right after the closing one.
 */
const INLINE_MATH = /(?<![\\$])\$(?!\$)([^\s$](?:[^\n$]*[^\s$])?)\$(?![\d$])/g;

const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/**
 * Escapes the dollar signs that are not math, so that prose containing prices
 * or shell variables survives remark-math unchanged.
 *
 * @param content - Markdown source about to be rendered
 * @returns The same Markdown with non-math dollars backslash-escaped
 */
export function escapeNonMathDollars(content: string): string {
  // Keep the protected snippets out of the escaping pass; a plain string
  // placeholder is enough because the output is Markdown, not HTML.
  const stash: string[] = [];
  const keep = (snippet: string): string => {
    stash.push(snippet);
    return `\uE000${stash.length - 1}\uE001`;
  };

  return content
    .split(CODE)
    .map((chunk, index) => {
      if (index % 2 === 1) {
        return chunk; // code keeps its dollars as written
      }
      return chunk
        .replace(DISPLAY_MATH, keep)
        .replace(INLINE_MATH, keep)
        .replace(/(?<!\\)\$/g, '\\$')
        .replace(PLACEHOLDER, (_match, position: string) => stash[Number(position)]);
    })
    .join('');
}
