import ts from "typescript";
import {
  DEFAULT_FALLBACK_CHUNK_CHARS,
  MAX_KNOWLEDGE_CHUNKS_PER_FILE
} from "../../config/mcp-config.js";
import type {
  IncludedKnowledgeScanFile,
  KnowledgeChunk
} from "./chunk-types.js";
import { chunkTextWithFallback, createKnowledgeChunk } from "./fallback-chunker.js";

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

  return (
    modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

function getDeclarationName(statement: ts.Statement): string | undefined {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    return statement.name.text;
  }

  if (ts.isModuleDeclaration(statement)) {
    return statement.name.getText();
  }

  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations
      .map((declaration) =>
        ts.isIdentifier(declaration.name) ? declaration.name.text : undefined
      )
      .filter((name): name is string => Boolean(name));

    return names.length > 0 ? names.join(", ") : undefined;
  }

  return undefined;
}

function isChunkableTopLevelStatement(statement: ts.Statement): boolean {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return Boolean(getDeclarationName(statement));
  }

  return ts.isVariableStatement(statement) && hasExportModifier(statement);
}

function createSourceFile(params: {
  filePath: string;
  text: string;
}): ts.SourceFile {
  const scriptKind = params.filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;

  /**
   * The compiler API parses source text only. We never import target files or
   * execute project code, which keeps chunking on the safe read-only side of the
   * MCP boundary.
   */
  return ts.createSourceFile(
    params.filePath,
    params.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
}

function getParseDiagnosticCount(sourceFile: ts.SourceFile): number {
  const maybeWithDiagnostics = sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  };

  return maybeWithDiagnostics.parseDiagnostics?.length ?? 0;
}

export function chunkTypeScriptByAst(params: {
  text: string;
  scannedFile: IncludedKnowledgeScanFile;
  maxChunks?: number;
}): KnowledgeChunk[] {
  const maxChunks = Math.min(
    params.maxChunks ?? MAX_KNOWLEDGE_CHUNKS_PER_FILE,
    MAX_KNOWLEDGE_CHUNKS_PER_FILE
  );

  try {
    const sourceFile = createSourceFile({
      filePath: params.scannedFile.filePath,
      text: params.text
    });
    const parseDiagnosticCount = getParseDiagnosticCount(sourceFile);

    if (parseDiagnosticCount > 0) {
      return chunkTextWithFallback({
        text: params.text,
        scannedFile: params.scannedFile,
        maxChunks,
        metadata: {
          safeFallbackReason: "typescript-parse-diagnostics",
          parseDiagnosticCount
        }
      });
    }

    const chunks: KnowledgeChunk[] = [];
    const statements = sourceFile.statements.filter(isChunkableTopLevelStatement);

    for (const statement of statements) {
      if (chunks.length >= maxChunks) {
        break;
      }

      const symbolName = getDeclarationName(statement);
      const content = params.text
        .slice(statement.getFullStart(), statement.getEnd())
        .trim();

      if (content.length === 0) {
        continue;
      }

      if (content.length <= DEFAULT_FALLBACK_CHUNK_CHARS) {
        chunks.push(
          createKnowledgeChunk({
            scannedFile: params.scannedFile,
            chunkIndex: chunks.length,
            content,
            chunkingStrategy: "typescript-ast",
            symbolName,
            metadata: {
              astKind: ts.SyntaxKind[statement.kind],
              exported: hasExportModifier(statement),
              truncatedByChunkLimit:
                chunks.length + 1 === maxChunks &&
                statements.indexOf(statement) < statements.length - 1
            }
          })
        );
        continue;
      }

      const remainingChunks = maxChunks - chunks.length;
      const fallbackChunks = chunkTextWithFallback({
        text: content,
        scannedFile: params.scannedFile,
        startingChunkIndex: chunks.length,
        symbolName,
        chunkingStrategy: "typescript-ast",
        maxChunks: remainingChunks,
        metadata: {
          astKind: ts.SyntaxKind[statement.kind],
          exported: hasExportModifier(statement),
          splitLargeTypeScriptSymbol: true
        }
      });

      chunks.push(...fallbackChunks);
    }

    if (chunks.length > 0) {
      return chunks;
    }

    return chunkTextWithFallback({
      text: params.text,
      scannedFile: params.scannedFile,
      maxChunks,
      metadata: {
        safeFallbackReason: "no-top-level-symbols"
      }
    });
  } catch (error) {
    return chunkTextWithFallback({
      text: params.text,
      scannedFile: params.scannedFile,
      maxChunks,
      metadata: {
        safeFallbackReason: "typescript-parser-error",
        parserErrorName: error instanceof Error ? error.name : "unknown"
      }
    });
  }
}
