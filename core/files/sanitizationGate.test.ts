import { describe, expect, it } from "vitest";

import { MAX_UPLOAD_BYTES, sanitizeUpload, type IncomingFile } from "./sanitizationGate";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXE_HEADER = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ (Windows executable)
const STEP_HEADER = new TextEncoder().encode("ISO-10303-21;\nHEADER;");

function file(over: Partial<IncomingFile>): IncomingFile {
  return {
    filename: "drawing.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: 1024,
    header: PDF_HEADER,
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
      file({ declaredMimeType: "model/step", header: STEP_HEADER }),
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
    const r = sanitizeUpload(file({ header: EXE_HEADER }), "id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/do not match/i);
  });

  it("REJECTS a mismatched image (declared PNG, bytes are PDF)", () => {
    const r = sanitizeUpload(file({ declaredMimeType: "image/png", header: PDF_HEADER }), "id");
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

  it("REJECTS when the header is too short to match", () => {
    const r = sanitizeUpload(file({ header: new Uint8Array([0x25]) }), "id");
    expect(r.ok).toBe(false);
  });

  it("accepts a valid PNG", () => {
    const r = sanitizeUpload(file({ declaredMimeType: "image/png", header: PNG_HEADER }), "id3");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.extension).toBe("png");
  });
});
