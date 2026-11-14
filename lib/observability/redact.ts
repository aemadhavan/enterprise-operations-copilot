/**
 * Regex PII redaction (FR-017, Must). Applied before anything reaches logs,
 * Langfuse traces or audit `details`. Synthetic data only, but redaction runs anyway.
 * Order matters: email → card → phone → ID-like, so longer patterns win.
 */

/** Prefixes that are system identifiers, not PII: requests, tickets, fixture docs, golden cases. */
const ALLOWED_ID_PREFIXES = new Set(["AR", "TKT", "POL", "PRC", "REF", "VND", "MTG", "INC", "GS"]);

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** 13–19 digits, optionally grouped by single spaces or hyphens. */
const CARD = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;

/**
 * Phone numbers:
 * - international: +CC then 7–12 more digits in groups (space, hyphen, dot, parentheses)
 * - AU national: 0X followed by 8 digits, e.g. 0412 345 678, (03) 9123 4567
 */
const PHONE =
  /(?<![\w+])(?:\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}|\(0\d\)[ ]?\d{4}[ -]?\d{4}|0[2-478](?:[ -]?\d){8})(?![\d-])/g;

/** ID-like tokens such as EMP-104233 or CUST99812. */
const ID_LIKE = /\b([A-Z]{2,5})-?(\d{4,})\b/g;

/** Graph Person allow-list (T066, FR-017 Should). These authorized internal names are retained. */
export const ALLOWED_GRAPH_PERSON_NAMES = new Set([
  "Priya Nair",
  "Daniel Okafor",
  "Arjun Mehta",
  "Tom Gallagher",
  "Mei Lin Tan",
  "Sofia Reyes",
  "Hannah Brooks",
  "Grace Whitfield",
  "Liam Novak",
]);

const COMMON_NON_NAME_WORDS = new Set([
  "Contact",
  "Please",
  "Notify",
  "Email",
  "Send",
  "Tell",
  "Call",
  "Regarding",
  "Meeting",
  "Review",
  "Access",
  "Today",
  "System",
  "Vendor",
  "Policy",
  "Procedure",
  "The",
  "This",
  "That",
  "When",
  "After",
  "Before",
]);

/** Capitalized two-word name pattern, e.g. "Jane Doe" or "Robert Smith". */
const CAPITALIZED_NAME_PAIR = /\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g;

/**
 * Personal-name redaction (T066, FR-017 Should):
 * Redacts capitalized name pairs not present in the graph Person allow-list.
 */
export function redactNames(text: string, allowed = ALLOWED_GRAPH_PERSON_NAMES): string {
  return text.replace(CAPITALIZED_NAME_PAIR, (match, w1: string) => {
    if (COMMON_NON_NAME_WORDS.has(w1)) return match;
    return allowed.has(match) ? match : "[REDACTED:name]";
  });
}

export interface RedactOptions {
  redactNames?: boolean;
}

export function redact(text: string, opts: RedactOptions = {}): string {
  let out = text
    .replace(EMAIL, "[REDACTED:email]")
    .replace(CARD, "[REDACTED:card]")
    .replace(PHONE, "[REDACTED:phone]")
    .replace(ID_LIKE, (match, prefix: string) =>
      ALLOWED_ID_PREFIXES.has(prefix) ? match : "[REDACTED:id]",
    );
  if (opts.redactNames) {
    out = redactNames(out);
  }
  return out;
}

/** Redact every string inside a JSON-like value. Returns a copy. */
export function redactDeep<T>(value: T, opts: RedactOptions = {}): T {
  if (typeof value === "string") return redact(value, opts) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v, opts)]),
    ) as T;
  }
  return value;
}
