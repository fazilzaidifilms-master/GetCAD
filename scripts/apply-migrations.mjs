// Apply pending SQL files in db/migrations/ then db/policies/ (filename order)
// to the database at DATABASE_URL.
//
// Applied files are RECORDED in public.schema_migrations, so this is safe to
// re-run: already-applied files are skipped instead of replayed. (Replaying was
// the old behaviour and it aborted on the first `CREATE TABLE`/`CREATE TYPE`
// that already existed, making the script unusable against any live database.)
//
// Reads .env.local automatically, like the other operational scripts, so the
// connection string does not have to be typed onto a command line — where it
// lands in shell history and, on a shared screen, in front of whoever is
// looking. An explicitly-set DATABASE_URL still wins, so a one-off run against
// a different database works the way it always did.
//
// Usage:
//   npm run db:apply                      # uses .env.local
//   DATABASE_URL=postgres://... node scripts/apply-migrations.mjs   # override
//   ... --status     Show applied vs pending, change nothing.
//   ... --baseline   Record every current file as applied WITHOUT running it.
//                    Use this ONCE to adopt a database that already has the
//                    schema but no ledger (e.g. a project built before this
//                    script tracked state).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function loadEnvLocal() {
  try {
    const text = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      // An already-exported value wins, so an explicit one-off override still
      // works and this can never silently redirect a deliberate run.
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    // No .env.local — use whatever is already exported.
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Put it in .env.local, or pass it inline:\n" +
      "  DATABASE_URL=postgres://... npm run db:apply",
  );
  process.exit(1);
}

function sqlFilesIn(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

/** Every migration + policy file, in the order they must be applied. */
export function allSqlFiles() {
  return [
    ...sqlFilesIn(join(repoRoot, "db", "migrations")),
    ...sqlFilesIn(join(repoRoot, "db", "policies")),
  ];
}

/** Repo-relative key recorded in the ledger (stable across machines). */
function keyOf(file) {
  return file.replace(repoRoot + "/", "");
}

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename   text        PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

async function appliedSet(client) {
  await client.query(LEDGER_DDL);
  const { rows } = await client.query("SELECT filename FROM public.schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

/**
 * Apply every not-yet-applied file, each inside its own transaction together
 * with its ledger row — so a failed file records nothing and can be retried.
 */
export async function applyAll(client, { baseline = false } = {}) {
  const applied = await appliedSet(client);
  let count = 0;

  for (const file of allSqlFiles()) {
    const key = keyOf(file);
    if (applied.has(key)) {
      console.log("skip   ", key, "(already applied)");
      continue;
    }

    await client.query("BEGIN");
    try {
      if (!baseline) {
        await client.query(readFileSync(file, "utf8"));
      }
      await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [key]);
      await client.query("COMMIT");
      console.log(baseline ? "baseline" : "applied ", key);
      count += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`failed applying ${key}: ${err.message}`);
    }
  }

  return count;
}

async function printStatus(client) {
  const applied = await appliedSet(client);
  const files = allSqlFiles().map(keyOf);
  const pending = files.filter((f) => !applied.has(f));
  console.log(`${files.length} file(s) total — ${applied.size} applied, ${pending.length} pending.`);
  for (const f of pending) console.log("  pending", f);
  // A file recorded in the ledger but no longer on disk means the repo and the
  // database disagree about history — worth surfacing loudly.
  const orphans = [...applied].filter((f) => !files.includes(f));
  for (const f of orphans) console.warn("  WARNING recorded but missing from repo:", f);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const status = process.argv.includes("--status");
  const baseline = process.argv.includes("--baseline");

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    if (status) {
      await printStatus(client);
    } else {
      const n = await applyAll(client, { baseline });
      if (baseline) {
        console.log(`baselined ${n} file(s) — recorded as applied, nothing was executed.`);
      } else {
        console.log(n === 0 ? "nothing to apply — already up to date." : `applied ${n} file(s).`);
      }
    }
  } finally {
    await client.end();
  }
}
