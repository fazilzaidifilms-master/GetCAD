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
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await freshSchema(client);
  return client;
}
