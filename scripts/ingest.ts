// Ingest: documents → chunks → embeddings (FR-001). Idempotent: unchanged documents are
// skipped and only chunks without an embedding are embedded. Graph seed loading is added in T023.
import "./_env";
import { getConfig } from "@/lib/config";
import { closePool, getPool } from "@/lib/db/client";
import { assertEmbeddingModel, createEmbedder, toVectorLiteral } from "@/lib/retrieval/embed";
import { embeddingInput, loadDocuments, upsertDocuments } from "@/lib/retrieval/ingest";

async function main() {
  const config = getConfig();
  const pool = getPool();

  const { rows: models } = await pool.query<{ embedding_model: string }>(
    "SELECT DISTINCT embedding_model FROM chunks WHERE embedding_model IS NOT NULL",
  );
  assertEmbeddingModel(
    models.map((r) => r.embedding_model),
    config.EMBEDDING_MODEL,
  );

  const stats = await upsertDocuments(pool, await loadDocuments());
  console.log(
    `Documents: ${stats.documents} (${stats.changed.length} changed, ${stats.unchanged} unchanged); chunks in fixtures: ${stats.chunks}`,
  );

  const { rows: pending } = await pool.query<{
    id: string;
    title: string;
    section: string;
    text: string;
  }>(
    `SELECT c.id, d.title, c.section, c.text FROM chunks c JOIN documents d USING (doc_id)
     WHERE c.embedding IS NULL ORDER BY c.id`,
  );
  if (pending.length) {
    const embedder = createEmbedder({ cacheDir: null });
    const vectors = await embedder.embedDocuments(
      pending.map((p) => embeddingInput(p.title, p.section, p.text)),
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < pending.length; i++) {
        await client.query(
          "UPDATE chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3",
          [toVectorLiteral(vectors[i]), embedder.model, pending[i].id],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(`Embedded: ${pending.length} chunks with ${config.EMBEDDING_MODEL}`);

  const { rows } = await pool.query<{ docs: string; chunks: string; embedded: string }>(
    `SELECT (SELECT count(*) FROM documents) AS docs, (SELECT count(*) FROM chunks) AS chunks,
            (SELECT count(*) FROM chunks WHERE embedding IS NOT NULL) AS embedded`,
  );
  console.log(
    `Neon: ${rows[0].docs} documents, ${rows[0].chunks} chunks, ${rows[0].embedded} embedded`,
  );
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
