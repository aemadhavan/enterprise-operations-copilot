import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertEmbeddingModel,
  createEmbedder,
  EMBEDDING_DIM,
  type EmbeddingBackend,
  type InputType,
  withRateLimitRetry,
} from "@/lib/retrieval/embed";

const vec = (seed: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === seed ? 1 : 0));

function fakeBackend(model = "voyage-3.5") {
  const embed = vi.fn(async (texts: string[], inputType: InputType) =>
    inputType ? texts.map((_, i) => vec(i)) : [],
  );
  const backend: EmbeddingBackend = { model, embed };
  return { backend, embed };
}

describe("embedder (ADR-007, R-08)", () => {
  it("embeds documents in batches and returns one 1024-d vector per text", async () => {
    const { backend, embed } = fakeBackend();
    const e = createEmbedder({ backend, batchSize: 2, cacheDir: null });
    const out = await e.embedDocuments(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    expect(out.every((v) => v.length === EMBEDDING_DIM)).toBe(true);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0][1]).toBe("document");
  });

  it("caches query embeddings on disk, keyed by model + text", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "emb-"));
    const first = fakeBackend();
    await createEmbedder({ backend: first.backend, cacheDir }).embedQuery("max contractor days?");
    const second = fakeBackend();
    const v = await createEmbedder({ backend: second.backend, cacheDir }).embedQuery(
      "max contractor days?",
    );
    expect(first.embed).toHaveBeenCalledWith(["max contractor days?"], "query");
    expect(second.embed).not.toHaveBeenCalled();
    expect(v).toHaveLength(EMBEDDING_DIM);
  });

  it("does not share cache entries across models", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "emb-"));
    await createEmbedder({ backend: fakeBackend().backend, cacheDir }).embedQuery("q");
    const other = fakeBackend("amazon.titan-embed-text-v2:0");
    await createEmbedder({ backend: other.backend, cacheDir }).embedQuery("q");
    expect(other.embed).toHaveBeenCalledTimes(1);
  });

  it("rejects vectors with the wrong dimension", async () => {
    const backend: EmbeddingBackend = { model: "voyage-3.5", embed: async () => [[1, 2, 3]] };
    await expect(createEmbedder({ backend, cacheDir: null }).embedDocuments(["a"])).rejects.toThrow(
      /1024/,
    );
  });

  it("retries 429s with growing backoff and rethrows other errors", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    let calls = 0;
    const ok = await withRateLimitRetry(
      async () => {
        if (++calls < 3) throw Object.assign(new Error("rate"), { statusCode: 429 });
        return "ok";
      },
      { baseMs: 10, sleep },
    );
    expect(ok).toBe("ok");
    expect(sleeps).toEqual([10, 20]);
    await expect(
      withRateLimitRetry(
        async () => {
          throw Object.assign(new Error("bad"), { statusCode: 400 });
        },
        { sleep },
      ),
    ).rejects.toThrow("bad");
  });

  it("fails when the index was built with a different embedding model", () => {
    expect(() => assertEmbeddingModel(["voyage-3.5"], "voyage-3.5")).not.toThrow();
    expect(() => assertEmbeddingModel([], "voyage-3.5")).not.toThrow();
    expect(() => assertEmbeddingModel(["voyage-3"], "voyage-3.5")).toThrow(/re-index/);
  });
});
