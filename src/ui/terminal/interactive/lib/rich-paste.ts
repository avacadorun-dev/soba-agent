import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePasteBytes, type PasteMetadata, stripAnsiSequences } from "@opentui/core";

export const LARGE_PASTE_MIN_CHARS = 800;
export const LARGE_PASTE_MIN_LINES = 6;
export const MAX_DRAFT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DRAFT_IMAGES = 3;

export type ComposerBlock =
  | {
      id: number;
      type: "text";
      text: string;
      chars: number;
      lines: number;
    }
  | {
      id: number;
      type: "image";
      mimeType: string;
      data: string;
      bytes: number;
    };

export type ComposerBlockInput =
  | {
      type: "text";
      text: string;
      chars: number;
      lines: number;
    }
  | {
      type: "image";
      mimeType: string;
      data: string;
      bytes: number;
    };

export function createTextComposerBlock(text: string): Extract<ComposerBlockInput, { type: "text" }> {
  const normalized = normalizePastedText(text);
  return {
    type: "text",
    text: normalized,
    chars: normalized.length,
    lines: countLines(normalized),
  };
}

export function createImageComposerBlock(mimeType: string, bytes: Uint8Array): Extract<ComposerBlockInput, { type: "image" }> {
  return {
    type: "image",
    mimeType,
    data: Buffer.from(bytes).toString("base64"),
    bytes: bytes.byteLength,
  };
}

export function classifyPastedText(text: string): "inline" | "block" {
  const normalized = normalizePastedText(text);
  return normalized.length < LARGE_PASTE_MIN_CHARS && countLines(normalized) < LARGE_PASTE_MIN_LINES
    ? "inline"
    : "block";
}

export function blockFromPasteBytes(bytes: Uint8Array, metadata?: PasteMetadata): ComposerBlockInput | null {
  const mimeType = resolveImageMimeType(bytes, metadata?.mimeType);
  if (mimeType) {
    return createImageComposerBlock(mimeType, bytes);
  }
  return createTextComposerBlock(decodePasteBytes(bytes));
}

export function formatComposerBlock(block: ComposerBlock): string {
  if (block.type === "text") {
    return `[Pasted text · ${block.lines} ${block.lines === 1 ? "line" : "lines"} · ${block.chars} chars]`;
  }
  return `[Image · ${block.mimeType} · ${formatBytes(block.bytes)}]`;
}

export function composerBlockToPromptText(block: ComposerBlock): string {
  if (block.type === "text") return block.text;
  return `[Image: ${block.mimeType}, ${formatBytes(block.bytes)}]`;
}

export function composerBlockImageCount(blocks: ComposerBlock[]): number {
  return blocks.filter((block) => block.type === "image").length;
}

export function dataUrlForImageBlock(block: Extract<ComposerBlock, { type: "image" }>): string {
  return `data:${block.mimeType};base64,${block.data}`;
}

export function validateComposerBlock(block: ComposerBlockInput, existingBlocks: ComposerBlock[]): string | null {
  if (block.type !== "image") return null;
  if (block.bytes > MAX_DRAFT_IMAGE_BYTES) {
    return `Image is too large (${formatBytes(block.bytes)}). Limit is ${formatBytes(MAX_DRAFT_IMAGE_BYTES)}.`;
  }
  if (composerBlockImageCount(existingBlocks) >= MAX_DRAFT_IMAGES) {
    return `Too many images attached. Limit is ${MAX_DRAFT_IMAGES}.`;
  }
  return null;
}

export async function readClipboardImageBlock(): Promise<ComposerBlockInput | null> {
  if (process.platform !== "darwin") return null;
  const outputPath = join(tmpdir(), `soba-clipboard-${process.pid}-${Date.now()}.png`);
  const script = [
    `set outputPath to POSIX file "${outputPath.replaceAll('"', '\\"')}"`,
    "try",
    "  set pngData to the clipboard as «class PNGf»",
    "  set outputFile to open for access outputPath with write permission",
    "  set eof outputFile to 0",
    "  write pngData to outputFile",
    "  close access outputFile",
    "on error",
    "  try",
    "    close access outputPath",
    "  end try",
    "  error",
    "end try",
  ];

  const proc = Bun.spawn(["osascript", ...script.flatMap((line) => ["-e", line])], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  try {
    if (code !== 0 || !existsSync(outputPath)) return null;
    const bytes = readFileSync(outputPath);
    if (bytes.length === 0) return null;
    return createImageComposerBlock("image/png", bytes);
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  }
}

function normalizePastedText(text: string): string {
  return stripAnsiSequences(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function resolveImageMimeType(bytes: Uint8Array, metadataMimeType?: string): string | null {
  if (metadataMimeType?.startsWith("image/")) return metadataMimeType;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && Buffer.from(bytes.subarray(0, 6)).toString("ascii").startsWith("GIF")) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
