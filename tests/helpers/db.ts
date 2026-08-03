import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * Connection string for the throwaway test Postgres.
 * Defaults to the local cluster used in dev/CI; override with DATABASE_URL.
 */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres";

/**
 * Hosts this harness is allowed to destroy.
 *
 * WHY THIS EXISTS. `freshSchema` below drops `public`, `app` and `audit`. That
 * is correct and necessary for a deterministic suite, and catastrophic against
 * anything else. The one thing standing between the two was an environment
 * variable — and `DATABASE_URL` is exported into a shell for perfectly ordinary
 * reasons (`db:apply`, `verify:payment`, `verify:delivery`), where it then
 * lingers for the rest of the session.
 *
 * It has happened: a production Supabase database was dropped and rebuilt
 * because `npm run ci` ran in a terminal where `export DATABASE_URL=…` was
 * still set from a migration run half an hour earlier. Nothing about that
 * sequence looks dangerous while you are typing it.
 *
 * A README warning is not a control. This is.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "db", "test-db"]);

/**
 * Refuse to run the destructive harness against anything but a local database.
 *
 * The escape hatch is deliberately awkward to type and impossible to set by
 * accident, for the rare case of running the suite against a disposable remote
 * container in CI.
 */
export function assertDestroyable(connectionString: string): void {
  if (process.env.I_KNOW_THIS_DATABASE_IS_DISPOSABLE === "yes") return;

  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error(
      `The test harness could not parse DATABASE_URL, and it will not drop schemas ` +
        `in a database it cannot identify.`,
    );
  }

  if (LOCAL_HOSTS.has(host)) return;

  throw new Error(
    `\n\nREFUSING TO RUN: the test harness drops the public, app and audit schemas,\n` +
      `and DATABASE_URL points at "${host}" — not a local database.\n\n` +
      `This is almost always a shell where DATABASE_URL was exported for db:apply\n` +
      `or verify:payment and never unset. Open a new terminal, or run:\n\n` +
      `    unset DATABASE_URL\n\n` +
      `The suite uses a throwaway Postgres on 127.0.0.1:5433 (npm run test:db:up).\n`,
  );
}

function sqlFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Reset `public` to empty, then apply all migrations + policies in order.
 * Gives every test run an identical, fully-built schema.
 */
export async function freshSchema(client: Client): Promise<void> {
  // Checked here as well as at connect time: this function is exported, and the
  // guard belongs immediately in front of the DROP rather than only on the
  // path that usually reaches it.
  assertDestroyable(TEST_DATABASE_URL);
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("DROP SCHEMA IF EXISTS app CASCADE");
  await client.query("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.query("CREATE SCHEMA public");
  const files = [
    ...sqlFilesIn(join(repoRoot, "db", "migrations")),
    ...sqlFilesIn(join(repoRoot, "db", "policies")),
  ];
  for (const file of files) {
    await client.query(readFileSync(file, "utf8"));
  }
}

/**
 * Give a user a payout account in a chosen state.
 *
 * Since 0023 a RELEASE leg requires a VERIFIED payout account for its payee,
 * so any suite that releases escrow needs its designer/QC fixture to be
 * payable. Inserted directly rather than through upsert_payout_account(),
 * which needs an authenticated session for that specific user — this is
 * fixture setup, not a test of the write path.
 */
export async function givePayoutAccount(
  client: Client,
  userId: string,
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" = "VERIFIED",
): Promise<void> {
  await client.query(
    `INSERT INTO payout_accounts
       (user_id, beneficiary_name, pan, account_number, ifsc, account_type, status, rejection_reason)
     VALUES ($1, 'Test Beneficiary', 'ABCDE1234F', '123456789012', 'HDFC0001234', 'SAVINGS', $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET status = EXCLUDED.status, rejection_reason = EXCLUDED.rejection_reason`,
    [userId, status, status === "REJECTED" ? "fixture rejection" : null],
  );
}

/** Connect, apply a fresh schema, and hand back the client. */
export async function connectFreshDb(): Promise<Client> {
  // Before connecting, not after: there is no reason to open a session against
  // a database we are about to refuse to touch.
  assertDestroyable(TEST_DATABASE_URL);
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await freshSchema(client);
  return client;
}
