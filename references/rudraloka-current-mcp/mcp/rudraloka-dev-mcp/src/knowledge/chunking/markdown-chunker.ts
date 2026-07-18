import {
  DEFAULT_FALLBACK_CHUNK_CHARS,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE
} from "../../config/mcp-config.js";
import type {
  IncludedKnowledgeScanFile,
  KnowledgeChunk
} from "./chunk-types.js";
import {
  chunkTextWithFallback,
  createKnowledgeChunk
} from "./fallback-chunker.js";

type MarkdownSection = {
  headingPath: string[];
  content: string;
};

function cleanHeadingText(rawHeading: string): string {
  return rawHeading.replace(/\s+#+\s*$/, "").trim();
}

function splitMarkdownSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentLines: string[] = [];
  let currentHeadingPath: string[] = [];
  let inFence = false;

  function flushCurrentSection(): void {
    const content = currentLines.join("\n").trim();

    if (content.length > 0) {
      sections.push({
        headingPath: [...currentHeadingPath],
        content
      });
    }

    currentLines = [];
  }

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }

    const headingMatch = inFence ? null : /^(#{1,6})\s+(.+)$/.exec(line);

    if (headingMatch) {
      flushCurrentSection();

      const level = headingMatch[1].length;
      const headingText = cleanHeadingText(headingMatch[2]);

      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }

      headingStack.push({ level, text: headingText });
      currentHeadingPath = headingStack.map((heading) => heading.text);
    }

    currentLines.push(line);
  }

  flushCurrentSection();

  return sections;
}

export function chunkMarkdownByHeadings(params: {
  text: string;
  scannedFile: IncludedKnowledgeScanFile;
  maxChunks?: number;
}): KnowledgeChunk[] {
  const maxChunks = Math.min(
    params.maxChunks ?? MAX_KNOWLEDGE_CHUNKS_PER_FILE,
    MAX_KNOWLEDGE_CHUNKS_PER_FILE
  );
  const sections = splitMarkdownSections(params.text);
  const chunks: KnowledgeChunk[] = [];

  for (const section of sections) {
    if (chunks.length >= maxChunks) {
      break;
    }

    /**
     * Markdown headings carry human intent: a heading names the concept that
     * follows. Keeping that path on each chunk makes future retrieval easier to
     * cite and less likely to confuse adjacent sections.
     */
    if (section.content.length <= DEFAULT_FALLBACK_CHUNK_CHARS) {
      chunks.push(
        createKnowledgeChunk({
          scannedFile: params.scannedFile,
          chunkIndex: chunks.length,
          content: section.content,
          chunkingStrategy: "markdown-heading",
          headingPath: section.headingPath,
          metadata: {
            sectionHeadingDepth: section.headingPath.length,
            truncatedByChunkLimit:
              chunks.length + 1 === maxChunks &&
              sections.indexOf(section) < sections.length - 1
          }
        })
      );
      continue;
    }

    const remainingChunks = maxChunks - chunks.length;
    const fallbackChunks = chunkTextWithFallback({
      text: section.content,
      scannedFile: params.scannedFile,
      startingChunkIndex: chunks.length,
      headingPath: section.headingPath,
      chunkingStrategy: "markdown-heading",
      maxChunks: remainingChunks,
      metadata: {
        sectionHeadingDepth: section.headingPath.length,
        splitLargeMarkdownSection: true
      }
    });

    chunks.push(...fallbackChunks);
  }

  if (sections.length === 0) {
    return chunkTextWithFallback({
      text: params.text,
      scannedFile: params.scannedFile,
      chunkingStrategy: "fallback",
      maxChunks
    });
  }

  return chunks;
}
