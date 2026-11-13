-- 001_knowledge: knowledge tables loaded from fixtures (FR-001, FR-002, ADR-002).
-- Read-only at runtime. See specs/001-access-impact-copilot/data-model.md.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  doc_id           text PRIMARY KEY,                       -- e.g. POL-014
  title            text NOT NULL,
  doc_type         text NOT NULL
                   CHECK (doc_type IN ('policy','procedure','reference','standard','incident','meeting','meeting_notes')),
                   -- fixture uses 'meeting_notes'; data-model.md says 'meeting'. Both are discussion material.
  version          text,
  owner            text,
  source_system    text,
  effective_date   date,                                   -- null for MTG-* (discussion material, FR-008)
  is_authoritative boolean GENERATED ALWAYS AS (doc_type NOT IN ('meeting','meeting_notes')) STORED,
  content_hash     text NOT NULL,                          -- fixture drift detection
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id              bigserial PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  section         text NOT NULL,                           -- heading path, e.g. "3. Requirements > 3.4"
  text            text NOT NULL,
  tsv             tsvector GENERATED ALWAYS AS
                  (to_tsvector('english', coalesce(section, '') || ' ' || coalesce(text, ''))) STORED,
  embedding       vector(1024),                            -- voyage-3.5 / Titan V2, 1024-d (ADR-007)
  embedding_model text,                                    -- must equal the configured model
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, section)
);

CREATE INDEX chunks_tsv_gin       ON chunks USING gin (tsv);
CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_doc_id        ON chunks (doc_id);

CREATE TABLE nodes (
  id             text PRIMARY KEY,
  label          text NOT NULL,
  name           text NOT NULL,
  classification text CHECK (classification IN ('Public','Internal','Confidential','Restricted')),
  description    text,
  source_doc     text REFERENCES documents(doc_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nodes_label          ON nodes (label);
CREATE INDEX nodes_classification ON nodes (classification);

CREATE TABLE edges (
  id         bigserial PRIMARY KEY,
  source     text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation   text NOT NULL,                                -- one of the 15 relations (validated in lib/graph/load.ts)
  target     text NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  condition  text,                                         -- key=value[|value]
  source_doc text REFERENCES documents(doc_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX edges_source_relation ON edges (source, relation);
CREATE INDEX edges_target_relation ON edges (target, relation);
CREATE INDEX edges_relation        ON edges (relation);
