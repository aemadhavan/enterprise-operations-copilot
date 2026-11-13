import "./_env";
import path from "node:path";
import { closePool, getPool } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const dir = path.resolve("lib/db/migrations");

try {
  const applied = await runMigrations(getPool(), dir);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
