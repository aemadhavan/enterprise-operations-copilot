/**
 * List prices in US$ per million tokens (Claude API reference, cached 2026-11-03).
 * Cache writes are 1.25× input (5-minute TTL); cache reads as listed. Used for the
 * per-turn cost estimate (PRD §8.2, SC-009). Embedding calls (< $0.0001) are not counted.
 */
const PRICES: Record<string, { input: number; output: number; cache_read: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_read: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cache_read: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const bare = (model: string) => model.replace(/^anthropic\./, "");

/** Estimated cost of one response. Unknown models cost NaN, so a missing price is visible. */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[bare(model)];
  if (!p) return NaN;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  return (
    (u.input_tokens * p.input +
      write * p.input * 1.25 +
      read * p.cache_read +
      u.output_tokens * p.output) /
    1e6
  );
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  cache_creation_input_tokens:
    (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
});

export const ZERO_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
