import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const STUB_AUTH_SCHEMA = path.join(REPO_ROOT, "supabase", "tests", "stub-auth-schema.sql");
const GRANT_AUTHENTICATED_ACCESS = path.join(REPO_ROOT, "supabase", "tests", "grant-authenticated-access.sql");

const ADMIN_URL = process.env.RLS_TEST_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

function sanitizeDbName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Everything a Phase-0-style RLS test suite needs: a throwaway database with
 * every migration applied exactly as it would be on a real Supabase project
 * (see supabase/tests/stub-auth-schema.sql for what's stubbed and why), plus
 * a way to run a query "as" a given auth.users row the way PostgREST does —
 * `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '...'` inside
 * a transaction that always rolls back, so tests never leak state into each
 * other or need manual cleanup between assertions.
 */
export class RlsTestDatabase {
  private adminPool: Pool;
  private pool: Pool | null = null;
  readonly dbName: string;

  constructor() {
    this.dbName = sanitizeDbName(`hr_rls_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
    this.adminPool = new Pool({ connectionString: ADMIN_URL });
  }

  async setup(): Promise<void> {
    await this.adminPool.query(`CREATE DATABASE ${this.dbName}`);
    const dbUrl = new URL(ADMIN_URL);
    dbUrl.pathname = `/${this.dbName}`;
    this.pool = new Pool({ connectionString: dbUrl.toString() });

    await this.runSqlFile(STUB_AUTH_SCHEMA);
    for (const file of this.migrationFiles()) {
      await this.runSqlFile(file);
    }
    await this.runSqlFile(GRANT_AUTHENTICATED_ACCESS);
  }

  async teardown(): Promise<void> {
    await this.pool?.end();
    await this.adminPool.query(`DROP DATABASE IF EXISTS ${this.dbName}`);
    await this.adminPool.end();
  }

  private migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => path.join(MIGRATIONS_DIR, f));
  }

  private async runSqlFile(filePath: string): Promise<void> {
    const sql = readFileSync(filePath, "utf8");
    await this.requirePool().query(sql);
  }

  private requirePool(): Pool {
    if (!this.pool) throw new Error("RlsTestDatabase.setup() must be called before use");
    return this.pool;
  }

  /** Run arbitrary setup/seed SQL as the unrestricted admin connection. */
  async seed(sql: string): Promise<void> {
    await this.requirePool().query(sql);
  }

  /**
   * Run `fn` as if it were a PostgREST request from the given auth.users id
   * (or `null` for the anonymous role). Always rolls back — a test asserting
   * a write should happen still can't leave rows behind, keeping every test
   * independent of run order.
   */
  async asUser<T>(userId: string | null, fn: (query: Client["query"]) => Promise<T>): Promise<T> {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      if (userId) {
        await client.query("SET LOCAL ROLE authenticated");
        // SET doesn't accept bind parameters — set_config() does, and is
        // exactly how PostgREST/Supabase set this under the hood (the
        // third argument makes it transaction-local, like SET LOCAL).
        await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
      } else {
        await client.query("SET LOCAL ROLE anon");
      }
      const result = await fn(client.query.bind(client));
      return result;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
}
