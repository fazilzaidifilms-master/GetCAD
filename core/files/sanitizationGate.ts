/**
 * The single sanitization gate.
 *
 * EVERY uploaded file passes through sanitizeUpload() before it is stored or
 * served — there is no other path. The gate:
 *   1. allows only known-safe content types (allowlist),
 *   2. rejects oversized / empty files,
 *   3. verifies the file's MAGIC BYTES match the declared type (so a `.stl`
 *      that is really an executable, or a PDF-that-is-a-zip, is rejected),
 *   4. STRIPS IDENTITY: the stored object name is an opaque id + the verified
 *      extension — the caller's original filename (which can leak who made it)
 *      is never used.
 *
 * Pure and framework-free: the opaque id is injected, so this is fully
 * deterministic and testable. Nothing here touches storage or the network.
 */

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MiB

/** mime -> verified extension + how to recognise it. */
interface TypeRule {
  ext: string;
  /** Byte signatures (any match) OR a required UTF-8 text prefix. */
  magic: number[][] | { textPrefix: string };
}

export const DEFAULT_ALLOWLIST: Record<string, TypeRule> = {
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  // Many CAD deliverables are zip-based (3mf, some step packages, archives).
  "application/zip": { ext: "zip", magic: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]] }, // PK..
  // STEP: an ISO-10303-21 text CAD exchange file.
  "model/step": { ext: "step", magic: { textPrefix: "ISO-10303-21" } },
};

export interface IncomingFile {
  /** The client-supplied name — used ONLY for logging, never for the stored key. */
  filename: string;
  declaredMimeType: string;
  sizeBytes: number;
  /** The first bytes of the file, for magic-byte sniffing. */
  header: Uint8Array;
}

export interface SanitizedFile {
  /** Opaque object name to store under — no trace of the original filename. */
  objectName: string;
  contentType: string;
  extension: string;
  sizeBytes: number;
}

export type GateResult =
  | { ok: true; file: SanitizedFile }
  | { ok: false; reason: string };

export interface GateOptions {
  maxBytes?: number;
  allowlist?: Record<string, TypeRule>;
}

function headerMatches(header: Uint8Array, rule: TypeRule): boolean {
  if (Array.isArray(rule.magic)) {
    return rule.magic.some(
      (sig) => header.length >= sig.length && sig.every((b, i) => header[i] === b),
    );
  }
  const prefix = rule.magic.textPrefix;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(header.subarray(0, prefix.length + 8));
  return text.trimStart().startsWith(prefix);
}

/**
 * Validate + sanitize an incoming file. `opaqueId` is the caller-generated
 * opaque id (e.g. generateId()) used to build the stored object name.
 */
export function sanitizeUpload(
  input: IncomingFile,
  opaqueId: string,
  opts: GateOptions = {},
): GateResult {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const allowlist = opts.allowlist ?? DEFAULT_ALLOWLIST;

  const rule = allowlist[input.declaredMimeType];
  if (!rule) {
    return { ok: false, reason: `content type not allowed: ${input.declaredMimeType}` };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "empty file" };
  }
  if (input.sizeBytes > maxBytes) {
    return { ok: false, reason: `file too large (> ${maxBytes} bytes)` };
  }
  if (!headerMatches(input.header, rule)) {
    return { ok: false, reason: "file contents do not match the declared type" };
  }
  if (!opaqueId) {
    return { ok: false, reason: "missing opaque id" };
  }

  return {
    ok: true,
    file: {
      // Identity-stripped: only the opaque id + verified extension.
      objectName: `${opaqueId}.${rule.ext}`,
      contentType: input.declaredMimeType,
      extension: rule.ext,
      sizeBytes: input.sizeBytes,
    },
  };
}
