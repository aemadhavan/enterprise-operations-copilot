import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGoldenSet } from "@/evaluation/runner/cli";

/** PLAYBOOK anti-pattern: never copy golden-set questions into prompts (it overfits the eval). */
const SHINGLE = 6;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function shingles(s: string): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(" "));
  return out;
}

function promptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return promptFiles(p);
    return p.includes(`${path.sep}prompts${path.sep}`) && p.endsWith(".md") ? [p] : [];
  });
}

describe("prompts contain no golden-set questions", () => {
  const files = promptFiles("lib");
  const { cases } = loadGoldenSet();

  it("finds the prompt files", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s shares no 6-word run with any golden question", (file) => {
    const prompt = words(readFileSync(file, "utf8")).join(" ");
    const leaks = cases.flatMap((c) =>
      [...shingles(c.question)].filter((s) => prompt.includes(s)).map((s) => `${c.id}: "${s}"`),
    );
    expect(leaks).toEqual([]);
  });
});
