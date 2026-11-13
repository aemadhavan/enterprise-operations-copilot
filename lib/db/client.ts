import { neon, Pool, type NeonQueryFunction } from "@neondatabase/serverless";
import { getConfig, requireSetting } from "@/lib/config";

/**
 * Neon client wrapper (ADR-002).
 * - `sql`: HTTP tagged-template queries; one round trip each. Good for route handlers.
 * - `getPool()`: WebSocket pool for transactions and multi-statement SQL (migrations, ingest).
 */
let httpSql: NeonQueryFunction<false, false> | undefined;
let pool: Pool | undefined;

function databaseUrl(): string {
  return requireSetting(getConfig(), "DATABASE_URL");
}

export function sql(strings: TemplateStringsArray, ...params: unknown[]) {
  httpSql ??= neon(databaseUrl());
  return httpSql(strings, ...params);
}

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: databaseUrl() });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
