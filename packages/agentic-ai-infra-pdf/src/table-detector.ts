/**
 * Table detection for PDF page text.
 *
 * Detects GFM pipe-grid tables and tab-separated tables in raw page text.
 * Returns the detected tables and the remaining non-table text (with table
 * lines removed) so the caller can route table content to preserved chunks
 * and free text to the heading/fallback chunker.
 *
 * @module
 */

import type { MarkdownTable } from "./types.js";

/**
 * Aggregated result of table detection on a single page's text.
 */
export type TableDetectionResult = {
  /** All tables detected on this page (GFM markdown strings). */
  readonly tables: readonly MarkdownTable[];
  /**
   * The page text with all detected table lines removed.
   * Passed to the heading/fallback chunker so prose is split without
   * including table rows in prose chunks.
   */
  readonly remainingText: string;
};

// ---------------------------------------------------------------------------
// Internal region type — carries both the detected table and its line range
// ---------------------------------------------------------------------------

type TableRegion = {
  /** 0-indexed start line (inclusive) in the page's line array. */
  readonly start: number;
  /** 0-indexed end line (inclusive) in the page's line array. */
  readonly end: number;
  readonly table: MarkdownTable;
};

// ---------------------------------------------------------------------------
// Pipe-count and GFM-separator helpers
// ---------------------------------------------------------------------------

/** Counts the number of pipe characters in a line. */
function countPipes(line: string): number {
  return (line.match(/\|/g) ?? []).length;
}

/**
 * GFM separator pattern: a line starting and ending with `|` and containing
 * only hyphens, spaces, colons, and more pipes between the outer pipes.
 *
 * Matches examples:
 *   `|---|---|`
 *   `| --- | --- |`
 *   `| :-- | --: | :--: |`
 *   `| ---- | ----- | ----- |`
 */
const GFM_SEPARATOR_RE = /^\|[-| :]+\|$/;

function isGfmSeparator(line: string): boolean {
  return GFM_SEPARATOR_RE.test(line);
}

// ---------------------------------------------------------------------------
// Tab-count helper
// ---------------------------------------------------------------------------

function countTabs(line: string): number {
  return (line.match(/\t/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// Heuristic A: pipe-grid (GFM) tables
// ---------------------------------------------------------------------------

/**
 * Finds pipe-grid table regions in the line array.
 *
 * A valid region satisfies:
 * - Every line contains >= 2 pipe characters (contiguous block).
 * - The second line of the block matches the GFM separator pattern.
 * - The block has at least 3 lines (header + separator + 1 data row).
 *
 * Lines are preserved verbatim because they are already in GFM format.
 */
function findPipeGridRegions(lines: string[], pageNumber: number): TableRegion[] {
  const regions: TableRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    if (countPipes(lines[i]!) >= 2) {
      const start = i;

      // Collect contiguous lines with >= 2 pipes.
      while (i < lines.length && countPipes(lines[i]!) >= 2) {
        i++;
      }

      const end = i - 1;
      const blockLines = lines.slice(start, end + 1);

      // Validate: >= 3 lines AND second line is a GFM separator.
      if (blockLines.length >= 3 && isGfmSeparator(blockLines[1]!)) {
        const markdown = blockLines.join("\n");

        // rowCount: header + separator are excluded; remainder are data rows.
        const rowCount = blockLines.length - 2;

        // colCount: a GFM row like `| A | B | C |` has 4 pipes → 3 columns.
        const colCount = Math.max(0, (blockLines[0]!.match(/\|/g) ?? []).length - 1);

        regions.push({ start, end, table: { pageNumber, markdown, rowCount, colCount } });
      }
    } else {
      i++;
    }
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Heuristic B: tab-separated consistent-column tables
// ---------------------------------------------------------------------------

/**
 * Finds tab-separated table regions in the line array.
 *
 * A valid region satisfies:
 * - Every line contains >= 2 tab characters (contiguous block).
 * - Column count (tab count + 1) is consistent across all lines in the block.
 * - The block has at least 3 rows.
 *
 * Each region is converted to a GFM markdown table:
 * - Cells are split on `\t`, then wrapped as `| cell |`.
 * - A GFM separator row is inserted after the first (header) row.
 */
function findTabSeparatedRegions(lines: string[], pageNumber: number): TableRegion[] {
  const regions: TableRegion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (countTabs(line) >= 2) {
      const headerColCount = line.split("\t").length; // tab count + 1
      const start = i;

      // Collect contiguous lines with >= 2 tabs AND same column count.
      while (
        i < lines.length &&
        countTabs(lines[i]!) >= 2 &&
        lines[i]!.split("\t").length === headerColCount
      ) {
        i++;
      }

      const end = i - 1;
      const blockLines = lines.slice(start, end + 1);

      if (blockLines.length >= 3) {
        const gfmLines: string[] = [];

        for (let row = 0; row < blockLines.length; row++) {
          const cells = blockLines[row]!.split("\t");
          gfmLines.push("| " + cells.join(" | ") + " |");

          // Insert GFM separator row after the header.
          if (row === 0) {
            gfmLines.push("| " + cells.map(() => "---").join(" | ") + " |");
          }
        }

        const markdown = gfmLines.join("\n");
        const colCount = headerColCount;
        // rowCount: data rows only (excludes header, separator is synthetic).
        const rowCount = blockLines.length - 1;

        regions.push({ start, end, table: { pageNumber, markdown, rowCount, colCount } });
      }
    } else {
      i++;
    }
  }

  return regions;
}

// ---------------------------------------------------------------------------
// detectTables — public API
// ---------------------------------------------------------------------------

/**
 * Detects and extracts tables from a PDF page's raw text content.
 *
 * Two detection heuristics run on every page and their results are merged
 * (deduped by line position — a line can belong to at most one table region):
 *
 * **Heuristic A — Pipe-grid (GFM) tables:**
 * A contiguous block of lines where every line contains ≥ 2 pipe characters.
 * The second line must match the GFM separator pattern (`/^\|[-| :]+\|$/`).
 * Minimum 3 lines. Lines preserved verbatim (already GFM).
 *
 * **Heuristic B — Tab-separated tables:**
 * A contiguous block of lines where every line contains ≥ 2 tab characters,
 * with consistent column count (tab count + 1) across all lines.
 * Minimum 3 rows. Converted to GFM (cells wrapped, separator inserted).
 *
 * @param pageText - Raw text from a single PDF page.
 * @param pageNumber - 1-indexed page number; stored in each returned `MarkdownTable`.
 * @returns `{ tables, remainingText }` where `remainingText` is `pageText` with all
 *   detected table lines removed — ready for the heading/fallback chunker.
 *
 * @example
 * ```typescript
 * const { tables, remainingText } = detectTables(page.text, page.pageNumber);
 * // tables: [{ pageNumber: 2, markdown: "| A | B |\n|---|---|\n| 1 | 2 |", rowCount: 1, colCount: 2 }]
 * // remainingText: page text with the table block removed
 * ```
 */
export function detectTables(pageText: string, pageNumber: number): TableDetectionResult {
  if (!pageText.trim()) {
    return { tables: [], remainingText: pageText };
  }

  const lines = pageText.split(/\r?\n/);
  const coveredLines = new Set<number>();
  const tableRegions: TableRegion[] = [];

  // --- Heuristic A: pipe-grid tables ---
  for (const region of findPipeGridRegions(lines, pageNumber)) {
    // Skip if any line in this region is already claimed by a previous region.
    let conflict = false;

    for (let i = region.start; i <= region.end; i++) {
      if (coveredLines.has(i)) {
        conflict = true;
        break;
      }
    }

    if (conflict) continue;

    for (let i = region.start; i <= region.end; i++) {
      coveredLines.add(i);
    }

    tableRegions.push(region);
  }

  // --- Heuristic B: tab-separated tables ---
  for (const region of findTabSeparatedRegions(lines, pageNumber)) {
    let conflict = false;

    for (let i = region.start; i <= region.end; i++) {
      if (coveredLines.has(i)) {
        conflict = true;
        break;
      }
    }

    if (conflict) continue;

    for (let i = region.start; i <= region.end; i++) {
      coveredLines.add(i);
    }

    tableRegions.push(region);
  }

  // Sort by start position for stable, predictable ordering.
  tableRegions.sort((a, b) => a.start - b.start);

  const tables = tableRegions.map((r) => r.table);

  // Remaining text: all lines NOT claimed by any table region.
  const remainingText = lines
    .filter((_, idx) => !coveredLines.has(idx))
    .join("\n");

  return { tables, remainingText };
}
