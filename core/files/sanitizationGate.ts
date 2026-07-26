/**
 * The single sanitization gate.
 *
 * EVERY uploaded file passes through sanitizeUpload() before it is stored or
 * served — there is no other path. The gate:
 *   1. allows only known-safe content types (allowlist),
 *   2. rejects oversized / empty files,
 *   3. verifies the file's MAGIC BYTES match the declared type (so a `.stl`
 *      that is really an executable, or a PDF-that-is-a-zip, is rejected),
 *   4. STRIPS IDENTITY FROM THE NAME: the stored object name is an opaque id
 *      plus the verified extension — the caller's original filename (which can
 *      leak who made it) is never used,
 *   5. STRIPS IDENTITY FROM THE BYTES, when asked: EXIF, PNG text chunks and
 *      STEP author/organisation headers are removed (see metadataStripper).
 *
 * (5) is why there are TWO allowlists. Renaming a file hides the filename but
 * not the studio name sitting in its EXIF — so on the double-blind delivery
 * path we accept only formats we can actually clean.
 *
 * Pure and framework-free: the opaque id is injected, so this is fully
 * deterministic and testable. Nothing here touches storage or the network.
 */

import { STRIPPABLE_TYPES, stripMetadata } from "./metadataStripper";

/**
 * Hard ceiling for a single upload.
 *
 * This is NOT a free choice: uploads reach us through Next Server Actions, so
 * the transport's `bodySizeLimit` (next.config.mjs UPLOAD_BODY_LIMIT_MB) is the
 * real cap. A value larger than that would advertise a size the request could
 * never carry — which is exactly the bug this constant used to have (100 MiB
 * declared here vs Next's silent 1 MB default).
 * tests/config/upload-limits.test.ts asserts the two agree.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB

/** mime -> verified extension + how to recognise it. */
interface TypeRule {
  ext: string;
  /** Byte signatures (any match) OR a required UTF-8 text prefix. */
  magic: number[][] | { textPrefix: string };
}

const PDF_RULE: TypeRule = { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] }; // %PDF
const PNG_RULE: TypeRule = { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] };
const JPEG_RULE: TypeRule = { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] };
const ZIP_RULE: TypeRule = {
  ext: "zip",
  magic: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
  ],
}; // PK..
const STEP_RULE: TypeRule = { ext: "step", magic: { textPrefix: "ISO-10303-21" } };

/**
 * Broad allowlist for uploads where the uploader's identity is ALREADY known to
 * the reader — e.g. a designer application portfolio, which arrives attached to
 * the applicant's own name, email and phone. Metadata inside those files leaks
 * nothing that the form did not already state.
 */
export const DEFAULT_ALLOWLIST: Record<string, TypeRule> = {
  "application/pdf": PDF_RULE,
  "image/png": PNG_RULE,
  "image/jpeg": JPEG_RULE,
  // Many CAD deliverables are zip-based (3mf, some step packages, archives).
  "application/zip": ZIP_RULE,
  // STEP: an ISO-10303-21 text CAD exchange file.
  "model/step": STEP_RULE,
};

/**
 * Strict allowlist for the DOUBLE-BLIND delivery path (designer -> client).
 *
 * Only formats we can verifiably clean. Two deliberate exclusions:
 *
 *   ZIP — its central directory stores every internal filename and folder name
 *   verbatim ("Nakshatra_Studio/final_v3.3dm"), and its contents are never
 *   inspected, so it also defeats this allowlist entirely: any file type at all
 *   can travel inside one.
 *
 *   PDF — identity lives in the /Info dictionary AND in XMP metadata streams
 *   that may be compressed inside object streams. Cleaning that correctly needs
 *   a real PDF parser; a partial scrub that still leaks would be worse than an
 *   honest refusal.
 *
 * Both remain accepted on the application path above, where anonymity is not
 * the goal. Re-admitting them here is a future slice, not a config tweak.
 */
export const DELIVERABLE_ALLOWLIST: Record<string, TypeRule> = {
  "image/png": PNG_RULE,
  "image/jpeg": JPEG_RULE,
  "model/step": STEP_RULE,
};

export interface IncomingFile {
  /** The client-supplied name — used ONLY for logging, never for the stored key. */
  filename: string;
  declaredMimeType: string;
  sizeBytes: number;
  /** The complete file contents. Magic bytes are read from the front of this. */
  bytes: Uint8Array;
}

export interface SanitizedFile {
  /** Opaque object name to store under — no trace of the original filename. */
  objectName: string;
  contentType: string;
  extension: string;
  /** Size AFTER any metadata stripping — this is what actually gets stored. */
  sizeBytes: number;
  /**
   * The bytes to store. Identical to the input unless metadata stripping ran,
   * in which case this is the cleaned content. ALWAYS store this, never the
   * caller's original buffer.
   */
  bytes: Uint8Array;
  /** True when identifying metadata was actively removed from the content. */
  metadataStripped: boolean;
}

export type GateResult =
  | { ok: true; file: SanitizedFile }
  | { ok: false; reason: string };

export interface GateOptions {
  maxBytes?: number;
  allowlist?: Record<string, TypeRule>;
  /**
   * Require that identifying metadata be removed from the file's contents.
   * A type with no stripper is REJECTED rather than passed through — for an
   * anonymity guarantee, refusing a deliverable beats leaking one.
   * Defaults to the DELIVERABLE_ALLOWLIST when set and no allowlist is given.
   */
  requireMetadataStrip?: boolean;
}

function headerMatches(header: Uint8Array, rule: TypeRule): boolean {
  if (Array.isArray(rule.magic)) {
    return rule.magic.some(
      (sig) => header.length >= sig.length && sig.every((b, i) => header[i] === b),
    );
  }
  const prefix = rule.magic.textPrefix;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    header.subarray(0, prefix.length + 8),
  );
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
  const strip = opts.requireMetadataStrip ?? false;
  const allowlist = opts.allowlist ?? (strip ? DELIVERABLE_ALLOWLIST : DEFAULT_ALLOWLIST);

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
  if (!headerMatches(input.bytes, rule)) {
    return { ok: false, reason: "file contents do not match the declared type" };
  }
  if (!opaqueId) {
    return { ok: false, reason: "missing opaque id" };
  }

  let bytes = input.bytes;
  let metadataStripped = false;

  if (strip) {
    if (!(STRIPPABLE_TYPES as readonly string[]).includes(input.declaredMimeType)) {
      return {
        ok: false,
        reason: `cannot strip identifying metadata from ${input.declaredMimeType}; not accepted where anonymity is required`,
      };
    }
    const stripped = stripMetadata(input.bytes, input.declaredMimeType);
    if (!stripped.ok) {
      return { ok: false, reason: `metadata stripping failed: ${stripped.reason}` };
    }
    bytes = stripped.bytes;
    metadataStripped = true;
  }

  return {
    ok: true,
    file: {
      // Identity-stripped: only the opaque id + verified extension.
      objectName: `${opaqueId}.${rule.ext}`,
      contentType: input.declaredMimeType,
      extension: rule.ext,
      sizeBytes: bytes.length,
      bytes,
      metadataStripped,
    },
  };
}
