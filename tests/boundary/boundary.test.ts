import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const coreDir = join(repoRoot, "core");

// Run eslint on a single file and return whether it PASSED (exit 0).
function lintPasses(file: string): boolean {
  try {
    execFileSync(
      process.execPath,
      [join(repoRoot, "node_modules", "eslint", "bin", "eslint.js"), "--no-error-on-unmatched-pattern", file],
      { cwd: repoRoot, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

let tempDir: string | null = null;
function makeCoreFile(contents: string): string {
  tempDir = mkdtempSync(join(coreDir, "boundtest-"));
  const file = join(tempDir, "offender.ts");
  writeFileSync(file, contents, "utf8");
  return file;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("Test A — core/ boundary is enforced by lint", () => {
  it("FAILS lint when a core file imports next/*", () => {
    const file = makeCoreFile(
      `import { NextResponse } from "next/server";\nexport const x = NextResponse;\n`,
    );
    expect(lintPasses(file)).toBe(false);
  });

  it("FAILS lint when a core file imports react", () => {
    const file = makeCoreFile(`import * as React from "react";\nexport const y = React;\n`);
    expect(lintPasses(file)).toBe(false);
  });

  it("PASSES lint for a clean, framework-free core file", () => {
    const file = makeCoreFile(`export const z = 1 + 1;\n`);
    expect(lintPasses(file)).toBe(true);
  });
});
