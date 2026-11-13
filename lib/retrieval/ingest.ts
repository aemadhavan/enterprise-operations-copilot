import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "@neondatabase/serverless";
import { chunkDocument, parseDocument, type Chunk, type ParsedDocument } from "./chunk";

export interface LoadedDocument {
  doc: ParsedDocument;
  chunks: Chunk[];
}

/** Read and chunk every Markdown document in the fixture folder (FR-001). */
export async function loadDocuments(dir = "data/raw"): Promise<LoadedDocument[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (f) => {
      const doc = parseDocument(await readFile(path.join(dir, f), "utf8"));
      return { doc, chunks: chunkDocument(doc) };
    }),
  );
}

export interface IngestStats {
  documents: number;
  changed: string[];
  unchanged: number;
  chunks: number;
}

/**
 * Upsert documents and chunks. A document whose content_hash is unchanged is left alone
 * (its chunks and embeddings are kept); a changed one has its chunks replaced, leaving
 * `embedding` null for the embed step. Idempotent: a second run changes nothing.
 */
export async function upsertDocuments(pool: Pool, loaded: LoadedDocument[]): Promise<IngestStats> {
  const { rows } = await pool.query<{ doc_id: string; content_hash: string }>(
    "SELECT doc_id, content_hash FROM documents",
  );
  const existing = new Map(rows.map((r) => [r.doc_id, r.content_hash]));
  const changed: string[] = [];

  for (const { doc, chunks } of loaded) {
    if (existing.get(doc.doc_id) === doc.content_hash) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO documents (doc_id, title, doc_type, version, owner, source_system, effective_date, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (doc_id) DO UPDATE SET title=EXCLUDED.title, doc_type=EXCLUDED.doc_type,
           version=EXCLUDED.version, owner=EXCLUDED.owner, source_system=EXCLUDED.source_system,
           effective_date=EXCLUDED.effective_date, content_hash=EXCLUDED.content_hash`,
        [
          doc.doc_id,
          doc.title,
          doc.doc_type,
          doc.version,
          doc.owner,
          doc.source_system,
          doc.effective_date,
          doc.content_hash,
        ],
      );
      await client.query("DELETE FROM chunks WHERE doc_id = $1", [doc.doc_id]);
      for (const c of chunks) {
        await client.query("INSERT INTO chunks (doc_id, section, text) VALUES ($1,$2,$3)", [
          c.doc_id,
          c.section,
          c.text,
        ]);
      }
      await client.query("COMMIT");
      changed.push(doc.doc_id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Ingest of ${doc.doc_id} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return {
    documents: loaded.length,
    changed,
    unchanged: loaded.length - changed.length,
    chunks: loaded.reduce((n, l) => n + l.chunks.length, 0),
  };
}

/** Text sent to the embedding model: document title and section path give the chunk context. */
export const embeddingInput = (title: string, section: string, text: string) =>
  `${title} > ${section}
${text}`;
