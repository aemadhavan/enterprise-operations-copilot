import { sql } from "@/lib/db/client";
import { redact } from "@/lib/observability/redact";

export const AUDIT_EVENTS = [
  "proposed",
  "blocked",
  "superseded",
  "cancelled",
  "confirmed",
  "executed",
  "step_approved",
  "step_rejected",
  "sla_breached",
  "request_completed",
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export interface WriteAuditInput {
  actor?: string | null;
  event: AuditEvent;
  draft_id?: string | null;
  request_id?: string | null;
  ticket_id?: string | null;
  details?: Record<string, unknown>;
  policy_citations?: string[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  event: AuditEvent;
  draft_id: string | null;
  request_id: string | null;
  ticket_id: string | null;
  details: Record<string, unknown>;
  policy_citations: string[];
}

/** Label the stated actor as unverified (FR-015, PRD §11). */
export function formatAuditActor(actor?: string | null): string {
  const cleaned = redact((actor ?? "").trim()) || "anonymous";
  if (/\bunverified\b/i.test(cleaned)) return cleaned;
  return `${cleaned} (unverified)`;
}

/** Deep-redact every string leaf in `details` before writing to Postgres (FR-017). */
export function redactDetails<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDetails(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDetails(v)]),
    ) as T;
  }
  return value;
}

/**
 * Append one record to `audit_log` (FR-015, Constitution IV).
 * `audit_log` is protected by `REVOKE UPDATE, DELETE` and a raising trigger.
 */
export async function writeAudit(input: WriteAuditInput): Promise<AuditRow> {
  const actor = formatAuditActor(input.actor);
  const details = redactDetails(input.details ?? {});
  const citations = input.policy_citations ?? [];
  const rows = (await sql`
    INSERT INTO audit_log (
      actor, event, draft_id, request_id, ticket_id, details, policy_citations
    ) VALUES (
      ${actor},
      ${input.event},
      ${input.draft_id ?? null},
      ${input.request_id ?? null},
      ${input.ticket_id ?? null},
      ${JSON.stringify(details)}::jsonb,
      ${citations}::text[]
    )
    RETURNING
      id::int AS id,
      at::text AS at,
      actor,
      event,
      draft_id,
      request_id,
      ticket_id,
      details,
      policy_citations
  `) as AuditRow[];
  return rows[0];
}

export async function listAudit(
  opts: { limit?: number; draft_id?: string; request_id?: string } = {},
): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  if (opts.draft_id && opts.request_id) {
    return (await sql`
      SELECT id::int AS id, at::text AS at, actor, event, draft_id, request_id, ticket_id, details, policy_citations
      FROM audit_log
      WHERE draft_id = ${opts.draft_id}::uuid AND request_id = ${opts.request_id}
      ORDER BY id DESC LIMIT ${limit}
    `) as AuditRow[];
  }
  if (opts.draft_id) {
    return (await sql`
      SELECT id::int AS id, at::text AS at, actor, event, draft_id, request_id, ticket_id, details, policy_citations
      FROM audit_log
      WHERE draft_id = ${opts.draft_id}::uuid
      ORDER BY id DESC LIMIT ${limit}
    `) as AuditRow[];
  }
  if (opts.request_id) {
    return (await sql`
      SELECT id::int AS id, at::text AS at, actor, event, draft_id, request_id, ticket_id, details, policy_citations
      FROM audit_log
      WHERE request_id = ${opts.request_id}
      ORDER BY id DESC LIMIT ${limit}
    `) as AuditRow[];
  }
  return (await sql`
    SELECT id::int AS id, at::text AS at, actor, event, draft_id, request_id, ticket_id, details, policy_citations
    FROM audit_log
    ORDER BY id DESC LIMIT ${limit}
  `) as AuditRow[];
}
