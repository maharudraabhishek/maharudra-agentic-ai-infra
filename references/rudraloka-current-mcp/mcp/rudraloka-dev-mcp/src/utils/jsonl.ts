import fs from "node:fs/promises";
import path from "node:path";

import { MAX_LOG_FILE_BYTES } from "../config/mcp-config.js";

function getRotatedJsonlPath(filePath: string): string {
  const extension = path.extname(filePath);

  if (extension.length === 0) {
    return `${filePath}.1`;
  }

  return `${filePath.slice(0, -extension.length)}.1${extension}`;
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function rotateJsonlIfTooLarge(filePath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;

  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  if (!stat.isFile() || stat.size <= MAX_LOG_FILE_BYTES) {
    return;
  }

  const rotatedFilePath = getRotatedJsonlPath(filePath);

  await removeFileIfExists(rotatedFilePath);
  await fs.rename(filePath, rotatedFilePath);
}

/**
 * Append-only JSONL keeps logs simple, durable, and easy to summarize. The
 * parent directory is created here so callers cannot forget that setup step.
 *
 * The local MCP server speaks over STDIO, so log output must never be written
 * to stdout. A single-backup rotation keeps app.jsonl and audit.jsonl bounded
 * without adding another runtime dependency or changing the tool protocol.
 */
export async function appendJsonLine(
  filePath: string,
  record: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await rotateJsonlIfTooLarge(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}
