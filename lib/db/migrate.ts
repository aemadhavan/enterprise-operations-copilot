import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "@neondatabase/serverless";

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

const MIGRATION_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

/** Ordered `NNN_name.sql` files from the migrations folder. */
export async function listMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => MIGRATION_PATTERN.test(n)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

/** Pending = not yet applied. An applied file whose checksum changed is an error. */
export function planMigrations(
  files: MigrationFile[],
  applied: Map<string, string>,
): MigrationFile[] {
  for (const f of files) {
    const prev = applied.get(f.name);
    if (prev && prev !== f.checksum) {
      throw new Error(`Migration ${f.name} was edited after it was applied; add a new migration`);
    }
  }
  return files.filter((f) => !applied.has(f.name));
}

/** Apply pending migrations, each in its own transaction, recorded in schema_migrations. */
export async function runMigrations(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM schema_migrations",
  );
  const pending = planMigrations(
    await listMigrations(dir),
    new Map(rows.map((r) => [r.name, r.checksum])),
  );

  const done: string[] = [];
  for (const m of pending) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
        m.name,
        m.checksum,
      ]);
      await client.query("COMMIT");
      done.push(m.name);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return done;
}
