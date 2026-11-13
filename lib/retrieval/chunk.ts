import { createHash } from "node:crypto";
import matter from "gray-matter";

export interface ParsedDocument {
  doc_id: string;
  title: string;
  doc_type: string;
  version: string | null;
  owner: string | null;
  source_system: string | null;
  effective_date: string | null; // YYYY-MM-DD
  content_hash: string;
  body: string;
}

export interface Chunk {
  doc_id: string;
  section: string; // heading path, e.g. "3. Requirements > 3.4"
  text: string;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Parse front matter (gray-matter) and hash the raw file for drift detection. */
export function parseDocument(raw: string): ParsedDocument {
  const { data, content } = matter(raw);
  const doc_id = str(data.doc_id);
  if (!doc_id) throw new Error("Document front matter is missing doc_id");
  return {
    doc_id,
    title: str(data.title) ?? doc_id,
    doc_type: str(data.doc_type) ?? "reference",
    version: str(data.version),
    owner: str(data.owner),
    source_system: str(data.source_system),
    effective_date: str(data.effective_date),
    content_hash: createHash("sha256").update(raw.replace(/\r\n/g, "\n")).digest("hex"),
    body: content.replace(/\r\n/g, "\n"),
  };
}

const H1 = /^#\s+(.+?)\s*$/;
const H2 = /^##\s+(.+?)\s*$/;
const H3 = /^###\s+(.+?)\s*$/;
/** Numbered clause bullet: "- **3.4** text" → clause "3.4". */
const CLAUSE = /^[-*]\s+\*\*(\d+(?:\.\d+)+)\*\*\s*(.*)$/;

/**
 * Chunk by `##`/`###` headings (R-07). Numbered clause bullets (`- **3.4** …`) become
 * their own chunk so citations like "POL-014 §3.4" map to one section. Text between the
 * `#` title and the first `##` becomes a section named after the title; blockquote
 * banners before any `##` (the synthetic-document notice) are dropped.
 */
export function chunkDocument(doc: ParsedDocument): Chunk[] {
  const chunks: Chunk[] = [];
  let h2: string | null = null;
  let h3: string | null = null;
  let clause: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (!h2 || !text) return;
    const path = [h2, h3, clause].filter(Boolean).join(" > ");
    chunks.push({ doc_id: doc.doc_id, section: path, text });
  };

  for (const line of doc.body.split("\n")) {
    let m: RegExpMatchArray | null;
    if (!h2 && line.startsWith(">")) {
      continue; // synthetic banner
    } else if ((m = line.match(H1)) && !h2) {
      flush();
      h2 = m[1];
    } else if ((m = line.match(H2))) {
      flush();
      h2 = m[1];
      h3 = null;
      clause = null;
    } else if ((m = line.match(H3))) {
      flush();
      h3 = m[1];
      clause = null;
    } else if (h2 && (m = line.match(CLAUSE))) {
      flush();
      clause = m[1];
      buf.push(`${m[1]} ${m[2]}`);
    } else if (clause && line.trim() === "") {
      // blank line ends a clause; following text belongs to the section again
      flush();
      clause = null;
    } else {
      buf.push(clause ? line.trim() : line);
    }
  }
  flush();
  return chunks;
}
