import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { VoyageAIClient } from "voyageai";
import { getConfig, requireSetting, type Config } from "@/lib/config";

/** Both providers are used at 1024 dimensions, matching `chunks.embedding vector(1024)`. */
export const EMBEDDING_DIM = 1024;

export type InputType = "document" | "query";

export interface EmbeddingBackend {
  model: string;
  embed(texts: string[], inputType: InputType): Promise<number[][]>;
}

/**
 * Retry on HTTP 429 with backoff. Free-tier Voyage accounts are limited to 3 requests/min,
 * so waits start at 21 s. Other errors are rethrown immediately.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 21_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status !== 429 || attempt >= retries) throw err;
      await sleep(baseMs * (attempt + 1));
    }
  }
}

/** Voyage (default, ADR-007). */
export function voyageBackend(config: Config): EmbeddingBackend {
  const client = new VoyageAIClient({ apiKey: requireSetting(config, "VOYAGE_API_KEY") });
  return {
    model: config.EMBEDDING_MODEL,
    async embed(texts, inputType) {
      const res = await withRateLimitRetry(() =>
        client.embed({
          input: texts,
          model: config.EMBEDDING_MODEL,
          inputType,
          outputDimension: EMBEDDING_DIM,
        }),
      );
      const data = [...(res.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return data.map((d) => d.embedding ?? []);
    },
  };
}

/** Amazon Titan Text Embeddings V2 on Bedrock (AWS alternative). One text per call. */
export function titanBackend(config: Config): EmbeddingBackend {
  const client = new BedrockRuntimeClient({ region: config.AWS_REGION });
  return {
    model: config.EMBEDDING_MODEL,
    async embed(texts) {
      return Promise.all(
        texts.map(async (inputText) => {
          const res = await client.send(
            new InvokeModelCommand({
              modelId: config.EMBEDDING_MODEL,
              contentType: "application/json",
              accept: "application/json",
              body: JSON.stringify({ inputText, dimensions: EMBEDDING_DIM, normalize: true }),
            }),
          );
          const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] };
          return parsed.embedding;
        }),
      );
    },
  };
}

export function backendFromConfig(config: Config = getConfig()): EmbeddingBackend {
  return config.EMBEDDING_PROVIDER === "bedrock" ? titanBackend(config) : voyageBackend(config);
}

export interface Embedder {
  model: string;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

function checkDims(vectors: number[][]): number[][] {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`Embedding has ${v.length} dimensions; expected ${EMBEDDING_DIM}`);
    }
  }
  return vectors;
}

/**
 * Embedder with batching for documents and an on-disk cache for queries
 * (`evaluation/cache/embeddings`), so repeated eval runs make no embedding calls.
 * Pass `cacheDir: null` to disable the cache.
 */
export function createEmbedder(
  opts: { backend?: EmbeddingBackend; cacheDir?: string | null; batchSize?: number } = {},
): Embedder {
  const backend = opts.backend ?? backendFromConfig();
  const cacheDir = opts.cacheDir === undefined ? "evaluation/cache/embeddings" : opts.cacheDir;
  const batchSize = opts.batchSize ?? 16;

  const cachePath = (dir: string, text: string) => {
    const key = createHash("sha256").update(`${backend.model}|query|${text}`).digest("hex");
    return path.join(dir, `${key}.json`);
  };

  return {
    model: backend.model,
    async embedDocuments(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        out.push(...checkDims(await backend.embed(texts.slice(i, i + batchSize), "document")));
      }
      return out;
    },
    async embedQuery(text) {
      if (cacheDir) {
        try {
          return JSON.parse(await readFile(cachePath(cacheDir, text), "utf8")) as number[];
        } catch {
          // cache miss
        }
      }
      const [v] = checkDims(await backend.embed([text], "query"));
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cachePath(cacheDir, text), JSON.stringify(v));
      }
      return v;
    },
  };
}

/** ADR-007: the index must have been built with the configured model; otherwise re-index. */
export function assertEmbeddingModel(storedModels: string[], configured: string): void {
  const other = [...new Set(storedModels.filter((m) => m !== configured))];
  if (other.length) {
    throw new Error(
      `Index was built with ${other.join(", ")} but EMBEDDING_MODEL is ${configured}. ` +
        "Changing the embedding model needs a full re-index (truncate chunks and re-run ingest).",
    );
  }
}

/** pgvector literal, e.g. "[0.1,0.2,...]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
