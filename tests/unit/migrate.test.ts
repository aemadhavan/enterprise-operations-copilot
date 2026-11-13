import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listMigrations, planMigrations } from "@/lib/db/migrate";

async function fixtureDir(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "mig-"));
  await Promise.all(Object.entries(files).map(([n, s]) => writeFile(path.join(dir, n), s)));
  return dir;
}

describe("migration runner", () => {
  it("orders NNN_*.sql files and ignores others", async () => {
    const dir = await fixtureDir({
      "002_b.sql": "select 2;",
      "001_a.sql": "select 1;",
      "notes.md": "x",
    });
    expect((await listMigrations(dir)).map((m) => m.name)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("returns only unapplied migrations", async () => {
    const files = await listMigrations(
      await fixtureDir({ "001_a.sql": "select 1;", "002_b.sql": "select 2;" }),
    );
    const pending = planMigrations(files, new Map([["001_a.sql", files[0].checksum]]));
    expect(pending.map((m) => m.name)).toEqual(["002_b.sql"]);
  });

  it("refuses an applied migration whose content changed", async () => {
    const files = await listMigrations(await fixtureDir({ "001_a.sql": "select 1;" }));
    expect(() => planMigrations(files, new Map([["001_a.sql", "stale"]]))).toThrow(/edited/);
  });

  it("finds the real 001_knowledge migration", async () => {
    const names = (await listMigrations(path.resolve("lib/db/migrations"))).map((m) => m.name);
    expect(names[0]).toBe("001_knowledge.sql");
  });
});
