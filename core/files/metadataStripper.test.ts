import { describe, expect, it } from "vitest";

import { STRIPPABLE_TYPES, stripJpeg, stripMetadata, stripPng, stripStep } from "./metadataStripper";

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------- fixtures -- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!;
    for (let b = 0; b < 8; b += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): number[] {
  const typeBytes = [...enc.encode(type)];
  const body = new Uint8Array([...typeBytes, ...data]);
  const crc = crc32(body);
  return [
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
    ...body,
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
}

/** A PNG carrying a studio name in a tEXt chunk and an eXIf block. */
function pngWithMetadata(): Uint8Array {
  return new Uint8Array([
    ...PNG_SIG,
    ...pngChunk("IHDR", new Uint8Array(13)),
    ...pngChunk("tEXt", enc.encode("Author\0Nakshatra Studio")),
    ...pngChunk("iTXt", enc.encode("Software\0\0\0\0Rhino 8 — jane@studio.example")),
    ...pngChunk("eXIf", enc.encode("EXIFPAYLOAD-Nakshatra")),
    ...pngChunk("tIME", new Uint8Array(7)),
    ...pngChunk("IDAT", enc.encode("PIXELDATA")),
    ...pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function jpegSegment(marker: number, payload: Uint8Array): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

/** A JPEG carrying EXIF (APP1), XMP (APP1), IPTC (APP13) and a comment. */
function jpegWithMetadata(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    ...jpegSegment(0xe0, enc.encode("JFIF\0")),
    ...jpegSegment(0xe1, enc.encode("Exif\0\0Artist=Nakshatra Studio")),
    ...jpegSegment(0xe1, enc.encode("http://ns.adobe.com/xap/1.0/\0<dc:creator>Jane</dc:creator>")),
    ...jpegSegment(0xed, enc.encode("Photoshop 3.0\0IPTC credit: Nakshatra")),
    ...jpegSegment(0xfe, enc.encode("designed by jane@studio.example")),
    ...jpegSegment(0xdb, new Uint8Array(64)), // DQT — must survive
    ...jpegSegment(0xc0, new Uint8Array(15)), // SOF0 — must survive
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0x12, 0x34, 0x56, 0x78, // entropy-coded data
    0xff, 0xd9, // EOI
  ]);
}

const STEP_WITH_METADATA = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Ring design by Nakshatra Studio'),'2;1');
FILE_NAME('solitaire_final_v3.stp','2026-05-01T10:22:00',('Jane Doe'),
  ('Nakshatra Studio Pvt Ltd'),'Rhino 8','jane@studio.example','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 }'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=DIRECTION('',(0.,0.,1.));
ENDSEC;
END-ISO-10303-21;
`;

/* ---------------------------------------------------------------- tests -- */

describe("Test AR1 — PNG metadata stripping", () => {
  const original = pngWithMetadata();
  const result = stripPng(original);

  it("succeeds on a well-formed PNG", () => {
    expect(result.ok).toBe(true);
  });

  it("removes every trace of the studio name and author", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    expect(text).not.toContain("Nakshatra");
    expect(text).not.toContain("jane@studio.example");
    expect(text).not.toContain("Rhino 8");
  });

  it("drops the metadata chunks specifically", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    for (const chunk of ["tEXt", "iTXt", "eXIf", "tIME"]) {
      expect(text).not.toContain(chunk);
    }
  });

  it("keeps the chunks the image needs to decode", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    for (const chunk of ["IHDR", "IDAT", "IEND"]) {
      expect(text).toContain(chunk);
    }
    expect(dec.decode(result.bytes)).toContain("PIXELDATA");
  });

  it("preserves the PNG signature and shrinks the file", () => {
    if (!result.ok) throw new Error("strip failed");
    expect([...result.bytes.subarray(0, 8)]).toEqual(PNG_SIG);
    expect(result.bytes.length).toBeLessThan(original.length);
  });

  it("rejects bytes that are not a PNG", () => {
    const r = stripPng(enc.encode("not a png at all"));
    expect(r.ok).toBe(false);
  });
});

describe("Test AR2 — JPEG metadata stripping", () => {
  const original = jpegWithMetadata();
  const result = stripJpeg(original);

  it("succeeds on a well-formed JPEG", () => {
    expect(result.ok).toBe(true);
  });

  it("removes EXIF, XMP, IPTC and comment content", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    expect(text).not.toContain("Nakshatra");
    expect(text).not.toContain("jane@studio.example");
    expect(text).not.toContain("dc:creator");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("IPTC");
  });

  it("keeps SOI, the decode tables, and the image scan data", () => {
    if (!result.ok) throw new Error("strip failed");
    const b = result.bytes;
    expect([b[0], b[1]]).toEqual([0xff, 0xd8]); // SOI
    // DQT and SOF0 markers survive.
    const hasMarker = (m: number) => {
      for (let i = 0; i + 1 < b.length; i += 1) if (b[i] === 0xff && b[i + 1] === m) return true;
      return false;
    };
    expect(hasMarker(0xdb)).toBe(true); // DQT
    expect(hasMarker(0xc0)).toBe(true); // SOF0
    expect(hasMarker(0xda)).toBe(true); // SOS
    // Entropy-coded payload is copied verbatim.
    expect([...b.subarray(b.length - 6)]).toEqual([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
  });

  it("drops every APPn segment, including APP0/JFIF", () => {
    if (!result.ok) throw new Error("strip failed");
    const b = result.bytes;
    for (let i = 0; i + 1 < b.length; i += 1) {
      if (b[i] === 0xff && b[i + 1]! >= 0xe0 && b[i + 1]! <= 0xef) {
        // Only valid if it appears inside entropy-coded data, which our fixture
        // does not contain before SOS — so any APPn here is a real leak.
        const beforeSos = b.subarray(0, i).some((_, j) => b[j] === 0xff && b[j + 1] === 0xda);
        expect(beforeSos).toBe(true);
      }
    }
    expect(dec.decode(b)).not.toContain("JFIF");
  });

  it("rejects bytes that are not a JPEG", () => {
    expect(stripJpeg(enc.encode("nope")).ok).toBe(false);
  });
});

describe("Test AR3 — STEP metadata stripping", () => {
  const result = stripStep(enc.encode(STEP_WITH_METADATA));

  it("succeeds on a well-formed STEP file", () => {
    expect(result.ok).toBe(true);
  });

  it("removes author, organisation, tool and original filename", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    expect(text).not.toContain("Jane Doe");
    expect(text).not.toContain("Nakshatra Studio Pvt Ltd");
    expect(text).not.toContain("jane@studio.example");
    expect(text).not.toContain("Rhino 8");
    expect(text).not.toContain("solitaire_final_v3.stp");
    expect(text).not.toContain("Ring design by");
  });

  it("preserves the geometry (DATA section) byte-for-byte", () => {
    if (!result.ok) throw new Error("strip failed");
    const text = dec.decode(result.bytes);
    expect(text).toContain("#1=CARTESIAN_POINT('',(0.,0.,0.));");
    expect(text).toContain("#2=DIRECTION('',(0.,0.,1.));");
    expect(text).toContain("END-ISO-10303-21;");
  });

  it("preserves FILE_SCHEMA, which downstream CAD tools require", () => {
    if (!result.ok) throw new Error("strip failed");
    expect(dec.decode(result.bytes)).toContain("AUTOMOTIVE_DESIGN { 1 0 10303 214 }");
  });

  it("still starts with the ISO-10303-21 magic prefix", () => {
    if (!result.ok) throw new Error("strip failed");
    expect(dec.decode(result.bytes).startsWith("ISO-10303-21;")).toBe(true);
  });

  it("rejects bytes that are not STEP", () => {
    expect(stripStep(enc.encode("solid cube\nendsolid")).ok).toBe(false);
  });
});

describe("Test AR4 — stripper dispatch", () => {
  it("routes each strippable type to its stripper", () => {
    expect(stripMetadata(pngWithMetadata(), "image/png").ok).toBe(true);
    expect(stripMetadata(jpegWithMetadata(), "image/jpeg").ok).toBe(true);
    expect(stripMetadata(enc.encode(STEP_WITH_METADATA), "model/step").ok).toBe(true);
  });

  it("REFUSES an unknown type rather than passing it through uncleaned", () => {
    const r = stripMetadata(enc.encode("%PDF-1.7 whatever"), "application/pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no metadata stripper/i);
  });

  it("STRIPPABLE_TYPES matches what dispatch actually handles", () => {
    for (const t of STRIPPABLE_TYPES) {
      const r = stripMetadata(enc.encode("garbage"), t);
      // Garbage fails validation, but never with "no stripper" — the type is known.
      if (!r.ok) expect(r.reason).not.toMatch(/no metadata stripper/i);
    }
  });
});
