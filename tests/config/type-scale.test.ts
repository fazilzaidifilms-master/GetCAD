import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The app reads from the type scale. All of it, now.
 *
 * WHAT THIS FINISHES. The density system landed sizes as tokens, and then the
 * screens went on not using them: 157 places still said `text-sm` or `text-xs`,
 * which are fixed pixel values that no `data-density` attribute can reach. A
 * client on a phone got 14px body text because that is what Tailwind's `sm`
 * means, no matter what the design system said it should mean.
 *
 * MARKETING IS DELIBERATELY EXEMPT, and it is worth writing down why, because
 * "make it consistent" is the obvious wrong move here. The two halves use
 * disjoint parts of Tailwind's scale: the app uses xs/sm/xl and nothing else,
 * marketing uses sm/lg/3xl/4xl/5xl. Remapping the shared names at the config
 * level — the tempting one-line fix — would push marketing's body copy to 17px
 * while its lead paragraphs stayed at 18px, collapsing a hierarchy that is
 * correct as it is. A website and an app are different design problems.
 */

const APP = ["app/(app)", "components"];
const EXEMPT = "components/marketing";

const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(name) ? [rel] : [];
  });

const files = APP.flatMap(walk).filter((f) => !f.startsWith(EXEMPT));
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("app type sizes", () => {
  // Deliberately not `text-2xl` and up: those are headline sizes the app has
  // never used, and listing them would be guarding against nothing.
  const FIXED = /(?<![\w-])text-(xs|sm|base|lg|xl)(?![\w-])/;

  it("come from the density tokens, not Tailwind's fixed scale", () => {
    const offenders = files.filter((file) => FIXED.test(read(file)));
    expect(
      offenders,
      `fixed sizes ignore data-density — use text-[length:var(--fs-N)]: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The bug this caught while it was being written.
   *
   * A size token brings its own line-height, so appending one to a class that
   * already had `leading-relaxed` or `leading-none` leaves two competing
   * declarations — and which wins is CSS source order, not the order they are
   * written in the string. That is invisible in review and reproduces
   * inconsistently, which is the worst combination a layout bug can have.
   */
  it("never declare two line-heights or two trackings on one element", () => {
    const offenders: string[] = [];
    for (const file of files) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          const leadings = line.match(/(?<![\w-])leading-/g) ?? [];
          const trackings = line.match(/(?<![\w-])tracking-/g) ?? [];
          if (leadings.length > 1 || trackings.length > 1) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders, `competing declarations at: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the scale itself", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  const sizeOf = (token: string, scope: string): number => {
    const block = new RegExp(`${scope}[\\s\\S]*?--${token}:\\s*(\\d+)px`).exec(css);
    if (!block) throw new Error(`--${token} not found under ${scope}`);
    return Number(block[1]);
  };

  it("puts nothing informational below 15px on a client screen", () => {
    // --fs-1 is micro-caps only. Everything that carries a sentence starts here.
    expect(sizeOf("fs-2", ":root")).toBeGreaterThanOrEqual(15);
    expect(sizeOf("fs-3", ":root")).toBeGreaterThanOrEqual(17);
  });

  // Safari zooms the page when a focused input is under 16px, then leaves it
  // zoomed. Every form in the app was 14px, so every form did this.
  it("keeps form text above the size that makes iOS zoom on focus", () => {
    const input = readFileSync(join(process.cwd(), "components/ui/input.tsx"), "utf8");
    expect(input).toContain("text-[length:var(--fs-3)]");
    expect(sizeOf("fs-3", ":root")).toBeGreaterThanOrEqual(16);
  });

  it("still steps upward at every rung", () => {
    for (const scope of [":root", '\\[data-density="compact"\\]']) {
      const steps = [1, 2, 3, 4, 5, 6].map((n) => sizeOf(`fs-${n}`, scope));
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i], `${scope}: --fs-${i + 1} is not larger than --fs-${i}`).toBeGreaterThan(
          steps[i - 1]!,
        );
      }
    }
  });
});
