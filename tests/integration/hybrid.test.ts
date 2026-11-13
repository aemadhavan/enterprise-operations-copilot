import "../../scripts/_env";
import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "@/lib/db/client";
import { distinctDocIds, hybridSearch } from "@/lib/retrieval/hybrid";

// Needs DATABASE_URL + VOYAGE_API_KEY and a completed `pnpm ingest`.
const enabled = Boolean(process.env.DATABASE_URL && process.env.VOYAGE_API_KEY);

describe.skipIf(!enabled)("hybridSearch against Neon (FR-004)", () => {
  afterAll(closePool);

  it("finds POL-014 §3.4 for the GS-001 question", async () => {
    const results = await hybridSearch(
      "What is the maximum duration for contractor access to customer PII?",
    );
    expect(results.length).toBeGreaterThan(0);
    expect(distinctDocIds(results).slice(0, 5)).toContain("POL-014");
    const top = results.find((r) => r.doc_id === "POL-014");
    expect(top?.section).toBe("3. Requirements > 3.4");
    expect(top).toMatchObject({ doc_type: "policy", is_authoritative: true });
  });

  it("full-text alone retrieves POL-014 for the GS-001 question (OR semantics, R-07)", async () => {
    const results = await hybridSearch(
      "What is the maximum duration for contractor access to customer PII?",
      { arms: "fts" },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.vector_rank === null)).toBe(true);
    expect(distinctDocIds(results).slice(0, 5)).toContain("POL-014");
  });

  it("full-text alone matches a code-style query: CTL-08 hits REF-004", async () => {
    const results = await hybridSearch("CTL-08", { arms: "fts" });
    expect(distinctDocIds(results).slice(0, 5)).toContain("REF-004");
  });

  it("returns ranked chunks with metadata and both arm ranks", async () => {
    const results = await hybridSearch("access request records retention 7 years", { k: 10 });
    expect(results.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
    expect(results[0]).toHaveProperty("fts_rank");
    expect(results[0]).toHaveProperty("vector_rank");
    expect(distinctDocIds(results).slice(0, 5)).toContain("POL-030");
  });
});
