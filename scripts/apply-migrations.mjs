// Apply every SQL file in db/migrations/ then db/policies/ (filename order) to
// the database at DATABASE_URL. Each file runs inside its own transaction.
//
// Usage:
//   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/apply-migrations.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

function sqlFilesIn(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

export async function applyAll(client) {
  const files = [
    ...sqlFilesIn(join(repoRoot, "db", "migrations")),
    ...sqlFilesIn(join(repoRoot, "db", "policies")),
  ];
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
      console.log("applied", file.replace(repoRoot + "/", ""));
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`failed applying ${file}: ${err.message}`);
    }
  }
}

// Run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await applyAll(client);
    console.log("all migrations + policies applied.");
  } finally {
    await client.end();
  }
}
