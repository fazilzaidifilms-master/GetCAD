/**
 * Metadata stripping — the second half of anonymity for uploaded files.
 *
 * Renaming a file to an opaque id (sanitizationGate) removes the FILENAME, but
 * the bytes inside still carry who made them: EXIF in a JPEG, tEXt chunks in a
 * PNG, the author/organisation fields in a STEP header. In a double-blind
 * marketplace that is a direct breach — the client downloads the deliverable
 * and reads the designer's studio name out of it.
 *
 * Every function here is pure: bytes in, bytes out, no I/O. Each rebuilds the
 * container from its structural parts and keeps ONLY what is needed to render
 * or manufacture, so a metadata field we have never heard of is dropped by
 * default rather than passed through by default.
 */

export type StripResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: string };

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

/* ------------------------------------------------------------------ PNG -- */

/**
 * PNG is a sequence of length-prefixed, typed chunks. Metadata lives in
 * ancillary chunks (tEXt/iTXt/zTXt hold arbitrary key/value text; eXIf holds a
 * full EXIF block; tIME holds a modification timestamp).
 *
 * We keep an explicit allowlist of chunks that affect how the image DECODES or
 * RENDERS, and drop everything else.
 */
const PNG_KEEP = new Set([
  "IHDR", // header — required
  "PLTE", // palette — required for indexed colour
  "IDAT", // image data — required
  "IEND", // trailer — required
  "tRNS", // transparency
  "gAMA", // gamma
  "cHRM", // chromaticity
  "sRGB", // colour space
  "sBIT", // significant bits
  "bKGD", // background colour
  "hIST", // palette histogram
  "pHYs", // pixel dimensions (aspect ratio)
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function stripPng(bytes: Uint8Array): StripResult {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return { ok: false, reason: "not a PNG" };
  }

  const out: number[] = [...PNG_SIGNATURE];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(8, bytes.length - offset));
    const length = view.getUint32(0);
    const type = dec.decode(bytes.subarray(offset + 4, offset + 8));
    const chunkEnd = offset + 12 + length; // length + type + data + crc
    if (chunkEnd > bytes.length) {
      return { ok: false, reason: "truncated PNG chunk" };
    }

    if (PNG_KEEP.has(type)) {
      for (let i = offset; i < chunkEnd; i += 1) out.push(bytes[i]!);
    }

    offset = chunkEnd;
    if (type === "IEND") break;
  }

  if (out.length === PNG_SIGNATURE.length) {
    return { ok: false, reason: "PNG contained no usable chunks" };
  }
  return { ok: true, bytes: new Uint8Array(out) };
}

/* ----------------------------------------------------------------- JPEG -- */

/**
 * JPEG is a sequence of 0xFF-prefixed marker segments. Identity lives in:
 *   APP1  — EXIF (camera, GPS, Artist, Copyright) and XMP (author, tool)
 *   APP13 — IPTC (creator, credit, source)
 *   APP2  — ICC profile (can carry a description string)
 *   COM   — free-text comment
 *
 * We drop every APPn and COM segment. APP0/JFIF is not required for decoding —
 * it only declares density — so dropping it is safe and removes one more
 * fingerprintable field.
 *
 * Entropy-coded scan data after SOS is copied verbatim; it contains no metadata.
 */
export function stripJpeg(bytes: Uint8Array): StripResult {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ok: false, reason: "not a JPEG" };
  }

  const out: number[] = [0xff, 0xd8]; // SOI
  let offset = 2;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return { ok: false, reason: "malformed JPEG segment" };

    // Skip fill bytes.
    let marker = bytes[offset + 1]!;
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }

    if (marker === 0xd9) {
      out.push(0xff, 0xd9); // EOI
      break;
    }

    if (marker === 0xda) {
      // Start of scan: copy the header AND all remaining entropy-coded data.
      for (let i = offset; i < bytes.length; i += 1) out.push(bytes[i]!);
      break;
    }

    if (offset + 4 > bytes.length) return { ok: false, reason: "truncated JPEG segment" };
    const segLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const segEnd = offset + 2 + segLength;
    if (segLength < 2 || segEnd > bytes.length) {
      return { ok: false, reason: "truncated JPEG segment" };
    }

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (!isApp && !isComment) {
      for (let i = offset; i < segEnd; i += 1) out.push(bytes[i]!);
    }

    offset = segEnd;
  }

  return { ok: true, bytes: new Uint8Array(out) };
}

/* ----------------------------------------------------------------- STEP -- */

/**
 * STEP (ISO 10303-21) is TEXT. Its HEADER section is the leak:
 *
 *   FILE_NAME('part.stp','2026-01-01T00:00:00',('Jane Doe'),
 *             ('Nakshatra Studio'),'Rhino 8','','');
 *   FILE_DESCRIPTION(('designed by ...'),'2;1');
 *
 * Author and organisation are literally named fields. We rewrite the HEADER
 * with neutral values and copy the DATA section — the actual geometry —
 * byte-for-byte, so the model is untouched.
 */
const STEP_NEUTRAL_HEADER = [
  "HEADER;",
  "FILE_DESCRIPTION((''),'2;1');",
  "FILE_NAME('','1970-01-01T00:00:00',(''),(''),'','','');",
  "FILE_SCHEMA(());",
  "ENDSEC;",
].join("\n");

export function stripStep(bytes: Uint8Array): StripResult {
  const text = dec.decode(bytes);
  if (!text.trimStart().startsWith("ISO-10303-21")) {
    return { ok: false, reason: "not a STEP file" };
  }

  const headerStart = text.indexOf("HEADER;");
  const dataStart = text.indexOf("DATA;");
  if (headerStart === -1 || dataStart === -1 || dataStart < headerStart) {
    return { ok: false, reason: "STEP file has no HEADER/DATA sections" };
  }

  // Preserve the original FILE_SCHEMA — it declares which schema the geometry
  // conforms to, so replacing it would break downstream CAD tools.
  const header = text.slice(headerStart, dataStart);
  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(([^)]*)\)\s*\)\s*;/i.exec(header);
  const neutralHeader = schemaMatch
    ? STEP_NEUTRAL_HEADER.replace("FILE_SCHEMA(());", `FILE_SCHEMA((${schemaMatch[1]}));`)
    : STEP_NEUTRAL_HEADER;

  const rebuilt = `ISO-10303-21;\n${neutralHeader}\n${text.slice(dataStart)}`;
  return { ok: true, bytes: enc.encode(rebuilt) };
}

/* -------------------------------------------------------------- dispatch -- */

/** Content types this module can actually clean. */
export const STRIPPABLE_TYPES = ["image/png", "image/jpeg", "model/step"] as const;

/**
 * Strip identifying metadata from a file of a known content type.
 *
 * Returns `ok: false` rather than passing bytes through uncleaned — for an
 * anonymity guarantee, rejecting a deliverable is always better than leaking
 * one. A type with no stripper is a programming error, not a pass-through.
 */
export function stripMetadata(bytes: Uint8Array, contentType: string): StripResult {
  switch (contentType) {
    case "image/png":
      return stripPng(bytes);
    case "image/jpeg":
      return stripJpeg(bytes);
    case "model/step":
      return stripStep(bytes);
    default:
      return { ok: false, reason: `no metadata stripper for content type: ${contentType}` };
  }
}
