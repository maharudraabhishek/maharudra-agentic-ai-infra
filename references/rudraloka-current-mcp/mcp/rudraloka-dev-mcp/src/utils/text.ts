/**
 * Counts exact substring occurrences for safe patch application.
 *
 * Patches are only applied when the original text appears exactly once; this
 * prevents ambiguous replacements from touching the wrong section.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }

  return count;
}

/**
 * Preview output is for human review only. The stored proposal keeps the full
 * text, but MCP responses are capped to keep client context manageable.
 */
export function previewText(text: string, maxChars = 8_000): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[preview truncated]`;
}
