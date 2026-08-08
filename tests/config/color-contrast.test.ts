import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The palette, checked by arithmetic rather than by eye.
 *
 * WHY THIS TEST EXISTS. Colour is the one part of a design system where being
 * wrong is invisible to the person who made it. The author has a good screen,
 * full brightness, an office with blinds, and thirty-year-old eyes; the person
 * reading "Payment held" has a three-year-old phone at half brightness in a
 * showroom with the door open. Nobody catches a 4.2:1 by looking at it. So the
 * ratios are computed from the token values themselves, straight out of
 * `globals.css`, and an edit that drops one below its floor fails the build.
 *
 * It is a source-text test, which is unusual here and deliberate: the values
 * only exist as CSS custom properties, and no unit test can render a page to
 * ask a browser what colour something came out. Parsing the file is the only
 * place the numbers can be got at.
 *
 * THE FLOORS, AND WHY THEY DIFFER:
 *
 *   7.0  (AAA)  body and secondary text. AA's 4.5 is a legibility floor, not a
 *               comfort one, and the audience here is 40+ on a phone.
 *   4.5  (AA)   text on a coloured surface — badges, toned panels, buttons.
 *               Their text is short, known, and backed by shape and position.
 *   3.0  (AA non-text, WCAG 1.4.11) the boundary of a CONTROL. This is what
 *               makes an input findable before you click it.
 *
 * The first time it ran it found two genuine defects that had shipped: white
 * text on dark mode's lightened accent (2.82:1, on every primary button), and
 * white on the dark destructive fill (4.39:1, on Refund and Cancel).
 */

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Both shapes this file uses:
 *   `0 0% 96.5%`        — a bare HSL triple, Tailwind wraps it in hsl()
 *   `hsl(228 69% 46%)`  — a complete colour, consumed through var() directly
 *
 * Values carrying an alpha (the `-line` tokens) return null: they are edges
 * drawn over an unknown surface, so there is no honest pair to measure.
 */
function parseColor(raw: string): Rgb | null {
  const value = raw.trim().replace(/^hsl\(/, "").replace(/\)$/, "");
  if (value.includes("/")) return null;
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) return null;
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Every `--token: value` declared under a selector, later declarations winning
 * — which is what the cascade does, and this file declares `:root` and `.dark`
 * more than once each.
 */
function tokensFor(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`(^|[\\s}])${selector.replace(".", "\\.")}\\s*\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(CSS)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") depth -= 1;
      i += 1;
    }
    const body = CSS.slice(start, i - 1);
    for (const decl of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const [, name, value] = decl;
      if (name && value) out[name] = value.trim();
    }
  }
  return out;
}

const THEMES = {
  light: tokensFor(":root"),
  dark: tokensFor(".dark"),
} as const;

const TONES = ["neutral", "info", "attention", "success", "danger"] as const;

/** Resolves a token, falling back to light — dark only overrides what it changes. */
function colorOf(theme: keyof typeof THEMES, token: string): Rgb {
  const raw = THEMES[theme][token] ?? THEMES.light[token];
  const rgb = raw === undefined ? null : parseColor(raw);
  if (!rgb) throw new Error(`${theme}: ${token} is missing or unparseable (${raw})`);
  return rgb;
}

describe.each(["light", "dark"] as const)("%s theme", (theme) => {
  const check = (fg: string, bg: string, floor: number) => {
    const ratio = contrast(colorOf(theme, fg), colorOf(theme, bg));
    expect(
      Number(ratio.toFixed(2)),
      `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${floor}:1`,
    ).toBeGreaterThanOrEqual(floor);
  };

  it("sets body text at AAA", () => {
    check("--foreground", "--background", 7);
    check("--card-foreground", "--card", 7);
  });

  // The biggest single legibility lever in the file: this colour carries
  // timestamps, amounts, order meta and every inactive navigation label.
  it("sets secondary text at AAA too, on both surfaces it lands on", () => {
    check("--muted-foreground", "--background", 7);
    check("--muted-foreground", "--muted", 4.5);
  });

  // WCAG 1.4.11. An input you cannot find is an input you click around for.
  it("draws control boundaries you can actually see", () => {
    check("--input", "--background", 3);
  });

  it("keeps button labels legible on their own fills", () => {
    check("--primary-foreground", "--primary", 4.5);
    check("--destructive-foreground", "--destructive", 4.5);
    check("--secondary-foreground", "--secondary", 4.5);
    check("--accent-foreground", "--accent", 4.5);
  });

  it("keeps the accent usable as text and as a link", () => {
    check("--primary", "--background", 4.5);
    check("--primary", "--muted", 4.5);
  });

  describe.each(TONES)("the %s status family", (tone) => {
    it("is readable on its own fill", () => {
      check(`--tone-${tone}-fg`, `--tone-${tone}-bg`, 4.5);
    });

    // Toned text is also used as a bare line of prose on the page — "Funds
    // released to the payout legs" — with no fill behind it at all.
    it("is readable straight on the page", () => {
      check(`--tone-${tone}-fg`, "--background", 4.5);
    });

    it("declares an edge in the same hue", () => {
      const line = THEMES[theme][`--tone-${tone}-line`];
      expect(line, `${theme}: --tone-${tone}-line is missing`).toBeTruthy();
      expect(line, `${theme}: --tone-${tone}-line should carry an alpha`).toContain("/");
    });
  });
});

/**
 * The five families have to be the ONLY status colours, or they are not five
 * families — they are five families plus whatever the last person reached for.
 *
 * This is what the pass actually fixed: `emerald-700` in one file and
 * `emerald-600` in another, `amber-500/5` here and `amber-500/10` there, all
 * drawn by hand, all slightly different, all meaning the same thing.
 */
describe("no screen invents its own colour", () => {
  const SOURCES = ["app", "components", "lib"];
  const RAW_SWATCH =
    /(?:text|bg|border|ring|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}/;

  const walk = (dir: string): string[] => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(join(process.cwd(), dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) return walk(rel);
      return /\.tsx?$/.test(name) ? [rel] : [];
    });
  };

  it("uses the tone tokens rather than a raw Tailwind swatch", () => {
    const offenders = SOURCES.flatMap(walk).filter((file) =>
      RAW_SWATCH.test(readFileSync(join(process.cwd(), file), "utf8")),
    );
    expect(offenders, `these reach past the five families: ${offenders.join(", ")}`).toEqual([]);
  });
});
