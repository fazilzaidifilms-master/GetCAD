import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One card, drawn one way.
 *
 * WHAT WENT WRONG WITHOUT THIS. "A card" was never a component — it was a class
 * string, retyped in thirty-seven places across nineteen files, and it drifted
 * exactly as far as you would expect. Six different paddings (p-3 through p-10)
 * for the same idea. Two different radii, one of which — plain `rounded-lg` —
 * was a fixed 8px that ignored the density system entirely, so twenty-one
 * surfaces neither softened for a client on a phone nor tightened for staff.
 * Some had a shadow, most had none, which on a tinted page ground is the
 * difference between a card and a rectangle.
 *
 * None of that is visible while you are writing it. It is only visible later,
 * on a screen you are not looking at, as a vague sense that the app is not
 * quite made of the same thing throughout. So it is asserted instead.
 *
 * Marketing is deliberately exempt: it is a website, its surfaces are a
 * different design problem, and its white page is correct there.
 */

const APP_SOURCES = ["app/(app)", "components/ui", "components/domain", "components/pwa"];

const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(name) ? [rel] : [];
  });

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("the card surface", () => {
  const files = APP_SOURCES.flatMap(walk);

  /**
   * The canonical spelling. `Card` is the component to reach for, but a `<dl>`
   * of key/value rows and a `<Link>` that is itself a tappable card cannot
   * always be one, so the string has to be legal too — it just has to be THIS
   * string.
   */
  const CANONICAL = /rounded-\[var\(--r-lg\)\] border border-border bg-card shadow-\[var\(--e-1\)\]/;

  it("is never drawn with a fixed radius that ignores density", () => {
    const offenders = files.filter((file) =>
      /rounded-lg border border-border bg-card/.test(read(file)),
    );
    expect(
      offenders,
      `\`rounded-lg\` is a fixed 8px and does not respond to data-density: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("always carries its elevation, so it reads as raised off the ground", () => {
    const offenders = files.filter((file) => {
      const source = read(file);
      // A card that declares the border+background pair but no shadow.
      return (
        /rounded-\[var\(--r-lg\)\] border border-border bg-card(?! shadow)/.test(source) &&
        !CANONICAL.test(source)
      );
    });
    expect(offenders, `flat card surfaces in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("pads from the spacing scale rather than picking a number", () => {
    const offenders = files.filter((file) =>
      new RegExp(`${CANONICAL.source} p-\\d`).test(read(file)),
    );
    expect(
      offenders,
      `raw padding on a card surface (use p-[var(--s-N)]): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the radius scale", () => {
  const config = read("tailwind.config.ts");

  // The single change that fixed twenty-one surfaces without editing them: the
  // named scale now resolves to the density tokens, so `rounded-lg` written
  // before the design system existed became correct retroactively.
  it("resolves Tailwind's names to the density tokens", () => {
    for (const [name, token] of [
      ["sm", "--r-sm"],
      ["md", "--r-md"],
      ["lg", "--r-lg"],
      ["xl", "--r-xl"],
    ]) {
      expect(config, `borderRadius.${name} should read ${token}`).toMatch(
        new RegExp(`${name}:\\s*"var\\(${token}\\)"`),
      );
    }
  });

  it("no longer routes through the fixed --radius it replaced", () => {
    expect(read("app/globals.css")).not.toMatch(/^\s*--radius:/m);
  });
});
