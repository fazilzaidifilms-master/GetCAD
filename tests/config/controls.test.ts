import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every control in the app is the same height, and that height is a token.
 *
 * WHAT THIS FIXES. Five of the app's controls were `<select>` elements written
 * inline, three of them `h-9` — a fixed 36px. That is below the 44px every
 * platform asks of a touch target, and 12px shorter than the `Input` standing
 * next to it. On the file-upload form it produced a kind-chooser visibly
 * smaller than the button beside it, which is the single most "unfinished"
 * thing a form can do. One more, an `h-8` designer-reference field, was 32px.
 *
 * None of that was a decision anyone made. It is what happens when a control
 * is a class string rather than a component: the first one is written
 * carefully and the next four are copied from whichever was nearest.
 *
 * The controls stay NATIVE — a `<select>` opens the platform's own picker,
 * which this audience has used ten thousand times and which survives our
 * JavaScript failing to load. Only the dressing is ours.
 */

const APP = ["app/(app)", "components"];
const EXEMPT = ["components/marketing", "components/ui/select.tsx"];

const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(name) ? [rel] : [];
  });

const files = APP.flatMap(walk).filter((f) => !EXEMPT.some((e) => f.startsWith(e)));
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("form controls", () => {
  it("go through the shared Select rather than a bare element", () => {
    const offenders = files.filter((file) => /<select[\s>]/.test(read(file)));
    expect(
      offenders,
      `bare <select> — import { Select } from "@/components/ui/select": ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("never hard-code a height below the touch minimum", () => {
    const offenders: string[] = [];
    for (const file of files) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          // h-8 / h-9 / h-10 are 32/36/40px. Skeletons are exempt: they stand
          // in for content, not for something anyone taps.
          if (/(?<![\w-])h-(?:8|9|10)(?![\w-])/.test(line) && !/Skeleton/.test(line)) {
            offenders.push(`${file}:${i + 1}`);
          }
        });
    }
    expect(
      offenders,
      `fixed control heights below 44px (use --ctl / --ctl-sm): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  // The reason --ctl is 48px rather than the 44px platform floor: these are
  // one-way money and state actions taken on a phone, and an accidental
  // "Approve and release" is not undoable.
  it("keeps the default control height at or above 48px on a client screen", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const ctl = /:root[\s\S]*?--ctl:\s*(\d+)px/.exec(css);
    expect(ctl, "--ctl not found").toBeTruthy();
    expect(Number(ctl![1])).toBeGreaterThanOrEqual(48);
  });
});
