import { describe, expect, it } from "vitest";

import {
  DELIVERABLE_ALLOWLIST,
  MAX_UPLOAD_BYTES,
  sanitizeUpload,
  type IncomingFile,
} from "./sanitizationGate";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE_HEADER = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ (Windows executable)
const STEP_HEADER = new TextEncoder().encode("ISO-10303-21;\nHEADER;");

function file(over: Partial<IncomingFile>): IncomingFile {
  return {
    filename: "drawing.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: 1024,
    bytes: PDF_HEADER,
    ...over,
  };
}

describe("sanitizeUpload — the single gate", () => {
  it("ACCEPTS a valid PDF and strips the original filename", () => {
    const r = sanitizeUpload(file({ filename: "John_Doe_SECRET_project.pdf" }), "opaqueid123");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.objectName).toBe("opaqueid123.pdf");
      // no trace of the identity-leaking filename
      expect(r.file.objectName).not.toMatch(/john|doe|secret/i);
      expect(r.file.contentType).toBe("application/pdf");
    }
  });

  it("accepts a text-based CAD file (STEP) by content prefix", () => {
    const r = sanitizeUpload(
      file({ declaredMimeType: "model/step", bytes: STEP_HEADER }),
      "id2",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.objectName).toBe("id2.step");
  });

  it("REJECTS a disallowed content type", () => {
    const r = sanitizeUpload(file({ declaredMimeType: "application/x-msdownload" }), "id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not allowed/i);
  });

  it("REJECTS a disguised file (declared PDF, bytes are an EXE)", () => {
    const r = sanitizeUpload(file({ bytes: EXE_HEADER }), "id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/do not match/i);
  });

  it("REJECTS a mismatched image (declared PNG, bytes are PDF)", () => {
    const r = sanitizeUpload(file({ declaredMimeType: "image/png", bytes: PDF_HEADER }), "id");
    expect(r.ok).toBe(false);
  });

  it("REJECTS an oversized file", () => {
    const r = sanitizeUpload(file({ sizeBytes: MAX_UPLOAD_BYTES + 1 }), "id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });

  it("REJECTS an empty file", () => {
    const r = sanitizeUpload(file({ sizeBytes: 0 }), "id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/i);
  });

  it("REJECTS when the content is too short to match", () => {
    const r = sanitizeUpload(file({ bytes: new Uint8Array([0x25]) }), "id");
    expect(r.ok).toBe(false);
  });

  it("accepts a valid PNG", () => {
    const r = sanitizeUpload(file({ declaredMimeType: "image/png", bytes: PNG_HEADER }), "id3");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.extension).toBe("png");
  });
});

/* --------------------------------------------------------------------------
 * Test AR5 — the double-blind delivery path.
 *
 * requireMetadataStrip is what separates "we renamed the file" from "the bytes
 * carry no identity". A format we cannot clean must be REFUSED here, even
 * though it is perfectly acceptable on the application path where the reader
 * already knows who the uploader is.
 * ----------------------------------------------------------------------- */

const PNG_MIN = (() => {
  const enc = new TextEncoder();
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i += 1) {
      c ^= b[i]!;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...enc.encode(type), ...data]);
    const c = crc(body);
    return [
      (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff, data.length & 0xff,
      ...body,
      (c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff,
    ];
  };
  return new Uint8Array([
    ...PNG_HEADER,
    ...chunk("IHDR", new Uint8Array(13)),
    ...chunk("tEXt", new TextEncoder().encode("Author\0Nakshatra Studio")),
    ...chunk("IDAT", new TextEncoder().encode("PIXELS")),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
})();

describe("Test AR5 — delivery path requires strippable formats", () => {
  it("accepts a PNG and returns CLEANED bytes, not the original", () => {
    const r = sanitizeUpload(
      file({ declaredMimeType: "image/png", bytes: PNG_MIN, sizeBytes: PNG_MIN.length }),
      "id",
      { requireMetadataStrip: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.metadataStripped).toBe(true);
      const text = new TextDecoder().decode(r.file.bytes);
      expect(text).not.toContain("Nakshatra");
      expect(text).not.toContain("tEXt");
      // sizeBytes reports what is actually stored, not what was uploaded.
      expect(r.file.sizeBytes).toBe(r.file.bytes.length);
      expect(r.file.sizeBytes).toBeLessThan(PNG_MIN.length);
    }
  });

  it("REFUSES a PDF on the delivery path (cannot be cleaned)", () => {
    const r = sanitizeUpload(file({}), "id", { requireMetadataStrip: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not allowed|cannot strip/i);
  });

  it("REFUSES a ZIP on the delivery path (leaks internal filenames, hides its contents)", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const r = sanitizeUpload(
      file({ declaredMimeType: "application/zip", bytes: zip, sizeBytes: zip.length }),
      "id",
      { requireMetadataStrip: true },
    );
    expect(r.ok).toBe(false);
  });

  it("still ACCEPTS PDF and ZIP on the application path, where identity is known", () => {
    expect(sanitizeUpload(file({}), "id").ok).toBe(true);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(
      sanitizeUpload(
        file({ declaredMimeType: "application/zip", bytes: zip, sizeBytes: zip.length }),
        "id",
      ).ok,
    ).toBe(true);
  });

  it("leaves bytes untouched when stripping is not required", () => {
    const r = sanitizeUpload(
      file({ declaredMimeType: "image/png", bytes: PNG_MIN, sizeBytes: PNG_MIN.length }),
      "id",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.metadataStripped).toBe(false);
      expect(r.file.bytes).toBe(PNG_MIN);
    }
  });

  it("the delivery allowlist contains only formats a stripper handles", () => {
    expect(Object.keys(DELIVERABLE_ALLOWLIST).sort()).toEqual([
      "image/jpeg",
      "image/png",
      "model/step",
    ]);
  });
});
