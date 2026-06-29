// Deterministic, dependency-free secret scan over git-tracked files.
// Fails (exit 1) if it finds a likely committed secret, or a NEXT_PUBLIC_*
// variable that looks like it carries a secret. Runs in CI after the tests.
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const RULES = [
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key assignment", re: /aws_secret_access_key\s*[=:]\s*['"][^'"\n]{30,}['"]/i },
  { name: "Supabase service_role JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Generic API/secret key assignment", re: /(?:api[_-]?key|secret|password|token)\s*[=:]\s*['"][A-Za-z0-9_\-]{24,}['"]/i },
  // A secret must never be exposed to the browser via NEXT_PUBLIC_*. We match
  // unambiguously-secret words only — publishable/anon keys (e.g.
  // NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY) are public
  // by design and must NOT trip this rule.
  { name: "Secret leaked via NEXT_PUBLIC_*", re: /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)\b/ },
];

// This scanner file legitimately contains the patterns above; don't scan it.
const SELF = "scripts/secret-scan.mjs";

function trackedFiles() {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

let findings = 0;
for (const file of trackedFiles()) {
  if (file === SELF) continue;
  let content;
  try {
    if (statSync(file).size > 2_000_000) continue; // skip large binaries
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      if (rule.re.test(line)) {
        findings++;
        console.error(`SECRET[${rule.name}] ${file}:${i + 1}`);
      }
    });
  }
}

if (findings > 0) {
  console.error(`\nsecret-scan: ${findings} potential secret(s) found.`);
  process.exit(1);
}
console.log("secret-scan: clean.");
