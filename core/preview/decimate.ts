/**
 * Turning a CAD model into something safe to show before it has been paid for.
 *
 * THE PROBLEM. A 3D preview is the product's differentiator, and the naive
 * version of it destroys the business. Rendering a 3DM or STL in the browser
 * means shipping the actual file to the client's device — at which point they
 * have the model, before approval and before the money is released. The whole
 * leverage of an escrow marketplace is that the deliverable stays behind the
 * gate until the work is paid for.
 *
 * THE ANSWER. Never send the real file. Send a DERIVED mesh: coarse enough to
 * be useless for manufacturing, faithful enough to judge the design by. The
 * client orbits and zooms a real 3D object and still cannot cast from it.
 *
 * WHY GRID CLUSTERING RATHER THAN A GOOD SIMPLIFIER. Edge-collapse algorithms
 * (quadric error metrics and friends) exist to lose as little as possible —
 * they preserve sharp features and silhouettes precisely because that is what
 * you normally want. Here that is exactly wrong. We WANT the fine detail gone:
 * the seat geometry, the prong tips, the wall thicknesses, the tolerances
 * somebody paid for. Vertex clustering snaps everything to a grid, which
 * destroys sub-grid detail unconditionally and cannot be tuned back into
 * fidelity by an attacker choosing a clever input. The crudeness is the point.
 *
 * It is also O(n) with no priority queue, which matters because this runs in
 * the uploader's browser on a phone.
 *
 * Framework-free and deterministic: same input, same output, every time.
 */

export interface Mesh {
  /** Triangle soup or indexed positions, xyz triples. */
  positions: Float32Array;
  /** Optional triangle indices. Absent means positions are already a soup. */
  indices?: Uint32Array;
}

export interface DecimateResult {
  mesh: Mesh;
  /** Triangles before and after, for the record and for the tests. */
  sourceTriangles: number;
  previewTriangles: number;
  /** The grid cell size actually used, in model units. */
  cellSize: number;
}

/**
 * How coarse the grid must be.
 *
 * Expressed as a fraction of the model's longest dimension rather than an
 * absolute size, so a 2mm earring post and a 60mm bangle are degraded by the
 * same proportion. A ring is roughly 20mm across; at 1/64 that is a ~0.3mm
 * cell, which is far larger than the tolerances a seat is cut to and larger
 * than the wall thicknesses that matter. Detail below it does not survive.
 */
export const DEFAULT_GRID_DIVISIONS = 64;

/** Bounding box of a set of xyz triples. */
export function bounds(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const v = positions[i + axis]!;
      if (v < min[axis]!) min[axis] = v;
      if (v > max[axis]!) max[axis] = v;
    }
  }
  // An empty or degenerate input has no meaningful box; zeroes keep the caller
  // from having to special-case NaN.
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** The longest edge of the bounding box — the scale everything is relative to. */
export function longestExtent(positions: Float32Array): number {
  const { min, max } = bounds(positions);
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/**
 * Reduce a mesh by snapping its vertices to a grid and dropping the triangles
 * that collapse.
 *
 * Each grid cell keeps ONE representative vertex — the average of everything
 * that landed in it, which keeps the surface roughly where it was rather than
 * jumping to cell corners. A triangle whose three vertices end up in fewer than
 * three distinct cells has no area left and is discarded; that is where most of
 * the reduction comes from on a detailed model.
 */
export function decimate(mesh: Mesh, divisions = DEFAULT_GRID_DIVISIONS): DecimateResult {
  const { positions, indices } = mesh;
  const triangleCount = indices ? indices.length / 3 : positions.length / 9;

  const extent = longestExtent(positions);
  // A zero-extent model (empty, or a single point) has nothing to decimate and
  // would divide by zero below.
  if (extent <= 0 || triangleCount === 0) {
    return {
      mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) },
      sourceTriangles: triangleCount,
      previewTriangles: 0,
      cellSize: 0,
    };
  }

  const cellSize = extent / Math.max(1, divisions);
  const { min } = bounds(positions);

  // cell key -> index into the new vertex list
  const cellToVertex = new Map<string, number>();
  const sums: number[] = [];
  const counts: number[] = [];

  const vertexFor = (px: number, py: number, pz: number): number => {
    const cx = Math.floor((px - min[0]) / cellSize);
    const cy = Math.floor((py - min[1]) / cellSize);
    const cz = Math.floor((pz - min[2]) / cellSize);
    const key = `${cx},${cy},${cz}`;
    let index = cellToVertex.get(key);
    if (index === undefined) {
      index = counts.length;
      cellToVertex.set(key, index);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[index * 3] = (sums[index * 3] ?? 0) + px;
    sums[index * 3 + 1] = (sums[index * 3 + 1] ?? 0) + py;
    sums[index * 3 + 2] = (sums[index * 3 + 2] ?? 0) + pz;
    counts[index] = (counts[index] ?? 0) + 1;
    return index;
  };

  const outIndices: number[] = [];
  for (let t = 0; t < triangleCount; t += 1) {
    const corner = (n: number): number => {
      const vertexIndex = indices ? indices[t * 3 + n]! : t * 3 + n;
      const o = vertexIndex * 3;
      return vertexFor(positions[o]!, positions[o + 1]!, positions[o + 2]!);
    };
    const a = corner(0);
    const b = corner(1);
    const c = corner(2);
    // Collapsed to a line or a point: no area, nothing to draw.
    if (a === b || b === c || a === c) continue;
    outIndices.push(a, b, c);
  }

  const outPositions = new Float32Array(counts.length * 3);
  for (let i = 0; i < counts.length; i += 1) {
    const n = counts[i]!;
    outPositions[i * 3] = sums[i * 3]! / n;
    outPositions[i * 3 + 1] = sums[i * 3 + 1]! / n;
    outPositions[i * 3 + 2] = sums[i * 3 + 2]! / n;
  }

  return {
    mesh: { positions: outPositions, indices: new Uint32Array(outIndices) },
    sourceTriangles: triangleCount,
    previewTriangles: outIndices.length / 3,
    cellSize,
  };
}

/**
 * Is this preview actually degraded enough to hand out?
 *
 * The check exists because "we decimate it" is a claim, and a claim about a
 * security property should be verified rather than assumed. A model that was
 * already coarse — a simple band, a blocked-out shape — may come through the
 * grid barely changed, and handing that over is handing over the model.
 *
 * Two independent conditions, both of which must hold:
 *   - the triangle count fell by at least half, and
 *   - the result is under an absolute ceiling.
 * The ratio alone would pass a 400,000-triangle model reduced to 190,000. The
 * ceiling alone would pass a model that was always tiny.
 */
export const MAX_PREVIEW_TRIANGLES = 20000;
export const MIN_REDUCTION_RATIO = 0.5;

export function previewIsSafe(result: DecimateResult): boolean {
  if (result.previewTriangles === 0) return false;
  if (result.previewTriangles > MAX_PREVIEW_TRIANGLES) return false;
  const reduction = 1 - result.previewTriangles / Math.max(1, result.sourceTriangles);
  return reduction >= MIN_REDUCTION_RATIO;
}

/**
 * Decimate harder until the result is safe, or give up.
 *
 * Halving the divisions each time quarters the cell count, so this converges in
 * a handful of passes for any real model. Returning null rather than shipping
 * a marginal preview is deliberate: the caller should fall back to no preview
 * at all, which loses a feature, instead of leaking a usable model, which loses
 * the business.
 */
export function decimateUntilSafe(mesh: Mesh, startDivisions = DEFAULT_GRID_DIVISIONS): DecimateResult | null {
  let divisions = startDivisions;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = decimate(mesh, divisions);
    if (previewIsSafe(result)) return result;
    // A model that is ALREADY under the ceiling and cannot be reduced by half
    // is one that was never detailed enough to protect. Coarsening further
    // would just produce nothing.
    if (result.previewTriangles === 0) return null;
    divisions = Math.max(4, Math.floor(divisions / 2));
    if (divisions === 4 && attempt > 0) return null;
  }
  return null;
}
