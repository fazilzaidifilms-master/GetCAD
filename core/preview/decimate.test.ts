import { describe, expect, it } from "vitest";

import {
  bounds,
  decimate,
  decimateUntilSafe,
  longestExtent,
  MAX_PREVIEW_TRIANGLES,
  previewIsSafe,
  type Mesh,
} from "./decimate";

/**
 * A dense sphere-ish blob standing in for a real CAD model.
 *
 * The default is 90,000 triangles, which is the point: a jewellery model
 * exported for casting is tens of thousands of triangles across ~20mm, and the
 * grid only merges anything when the triangulation is finer than the cell. A
 * sparse fixture would make these tests pass for the wrong reason.
 */
function denseMesh(rings = 300, segments = 300): Mesh {
  const positions: number[] = [];
  const at = (i: number, j: number): [number, number, number] => {
    const phi = (i / rings) * Math.PI;
    const theta = (j / segments) * Math.PI * 2;
    return [
      Math.sin(phi) * Math.cos(theta) * 10,
      Math.cos(phi) * 10,
      Math.sin(phi) * Math.sin(theta) * 10,
    ];
  };
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      positions.push(...a, ...b, ...c);
    }
  }
  return { positions: new Float32Array(positions) };
}

/** One triangle, 10 units across. */
const TRIANGLE: Mesh = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
};

describe("bounds and extent", () => {
  it("measures the box", () => {
    expect(bounds(TRIANGLE.positions)).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    expect(longestExtent(TRIANGLE.positions)).toBe(10);
  });

  it("does not produce NaN for an empty mesh", () => {
    expect(bounds(new Float32Array(0))).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    expect(longestExtent(new Float32Array(0))).toBe(0);
  });
});

describe("decimate", () => {
  it("reduces a dense model substantially", () => {
    const result = decimate(denseMesh());
    expect(result.sourceTriangles).toBeGreaterThan(50_000);
    expect(result.previewTriangles).toBeLessThan(result.sourceTriangles / 4);
  });

  // The crudeness is the security property, so it is asserted rather than
  // assumed: detail smaller than a grid cell must not survive.
  it("destroys detail below the cell size", () => {
    const mesh = denseMesh(150, 150);
    const coarse = decimate(mesh, 8);
    const fine = decimate(mesh, 64);
    expect(coarse.previewTriangles).toBeLessThan(fine.previewTriangles);
    expect(coarse.cellSize).toBeGreaterThan(fine.cellSize);
  });

  it("keeps the model roughly where it was", () => {
    const before = bounds(denseMesh().positions);
    const after = bounds(decimate(denseMesh()).mesh.positions);
    // Averaging within cells pulls vertices in slightly; a whole cell of drift
    // would mean the shape had moved, not just softened.
    for (const axis of [0, 1, 2] as const) {
      expect(Math.abs(after.min[axis] - before.min[axis])).toBeLessThan(1);
      expect(Math.abs(after.max[axis] - before.max[axis])).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    const a = decimate(denseMesh());
    const b = decimate(denseMesh());
    expect(Array.from(a.mesh.positions)).toEqual(Array.from(b.mesh.positions));
    expect(Array.from(a.mesh.indices!)).toEqual(Array.from(b.mesh.indices!));
  });

  it("handles an empty mesh without dividing by zero", () => {
    const result = decimate({ positions: new Float32Array(0) });
    expect(result.previewTriangles).toBe(0);
    expect(Number.isFinite(result.cellSize)).toBe(true);
  });

  it("accepts an indexed mesh as well as a soup", () => {
    const indexed: Mesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(decimate(indexed).sourceTriangles).toBe(1);
  });

  it("drops triangles that collapse into a line", () => {
    // Three vertices a hair apart: one grid cell, no area left.
    const tiny: Mesh = {
      positions: new Float32Array([
        0, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0,
        // A second, large triangle so the extent is not degenerate.
        0, 0, 0, 100, 0, 0, 0, 100, 0,
      ]),
    };
    expect(decimate(tiny).previewTriangles).toBe(1);
  });
});

describe("previewIsSafe", () => {
  it("passes a properly degraded model", () => {
    expect(previewIsSafe(decimate(denseMesh()))).toBe(true);
  });

  // The ratio alone would pass 400k triangles reduced to 190k.
  it("refuses a preview over the absolute ceiling", () => {
    expect(
      previewIsSafe({
        mesh: { positions: new Float32Array(0) },
        sourceTriangles: 1_000_000,
        previewTriangles: MAX_PREVIEW_TRIANGLES + 1,
        cellSize: 1,
      }),
    ).toBe(false);
  });

  // The ceiling alone would pass a model that was always tiny — which is the
  // case where "we decimated it" is a claim and not a fact.
  it("refuses a model that barely changed", () => {
    expect(
      previewIsSafe({
        mesh: { positions: new Float32Array(0) },
        sourceTriangles: 1000,
        previewTriangles: 900,
        cellSize: 1,
      }),
    ).toBe(false);
  });

  it("refuses an empty result", () => {
    expect(
      previewIsSafe({
        mesh: { positions: new Float32Array(0) },
        sourceTriangles: 1000,
        previewTriangles: 0,
        cellSize: 1,
      }),
    ).toBe(false);
  });
});

describe("decimateUntilSafe", () => {
  it("returns a safe preview for a real model", () => {
    const result = decimateUntilSafe(denseMesh());
    expect(result).not.toBeNull();
    expect(previewIsSafe(result!)).toBe(true);
  });

  // The case that matters most: a model too sparse to be degraded by the
  // default grid must be coarsened further rather than passed through.
  it("coarsens a model the default grid barely touches", () => {
    const sparse = denseMesh(60, 60);
    expect(previewIsSafe(decimate(sparse))).toBe(false);
    const result = decimateUntilSafe(sparse);
    expect(result).not.toBeNull();
    expect(previewIsSafe(result!)).toBe(true);
  });

  // Losing the feature beats leaking a usable model.
  it("gives up rather than shipping a marginal preview", () => {
    expect(decimateUntilSafe(TRIANGLE)).toBeNull();
  });

  it("gives up on an empty mesh", () => {
    expect(decimateUntilSafe({ positions: new Float32Array(0) })).toBeNull();
  });
});
