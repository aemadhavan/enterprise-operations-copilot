import { z } from "zod";

/**
 * Typed, Zod-validated runtime config (FR-025, ADR-007, ADR-010, Constitution V).
 * Next.js loads `.env.local` automatically; scripts import `scripts/_env.ts` first.
 * Secrets are optional here and checked where they are used, so `next build`
 * and the unit tests run without credentials.
 */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const positiveNumber = (def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().positive().default(def));

export const ConfigSchema = z.object({
  MODEL_PROVIDER: z.enum(["anthropic", "bedrock"]).default("anthropic"),

  ANTHROPIC_API_KEY: optionalString,
  ROUTER_MODEL: z.string().default("claude-haiku-5-5"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),

  AWS_REGION: z.string().default("ap-southeast-2"),
  BEDROCK_ROUTER_MODEL_ID: z.string().default("anthropic.claude-haiku-5-5"),
  BEDROCK_MODEL_ID: z.string().default("anthropic.claude-sonnet-5-5"),

  JUDGE_PROVIDER: z.enum(["anthropic", "bedrock"]).default("anthropic"),
  JUDGE_MODEL: z.string().default("claude-opus-5-5"),

  EMBEDDING_PROVIDER: z.enum(["voyage", "bedrock"]).default("voyage"),
  EMBEDDING_MODEL: optionalString,
  VOYAGE_API_KEY: optionalString,

  DATABASE_URL: optionalString,

  LANGFUSE_PUBLIC_KEY: optionalString,
  LANGFUSE_SECRET_KEY: optionalString,
  LANGFUSE_BASE_URL: z.string().url().default("https://jp.cloud.langfuse.com"),

  // v0.1 ships only the in-memory engine (tasks.md T047/T050); vercel-workflow is v0.2.
  APPROVAL_ENGINE: z.enum(["in-memory", "vercel-workflow"]).default("in-memory"),
  SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY: positiveNumber(60),

  DEMO_DAILY_SPEND_CAP_USD: positiveNumber(5),
  DEMO_RATE_LIMIT_PER_MIN: positiveNumber(10),
});

export type Config = z.infer<typeof ConfigSchema> & { EMBEDDING_MODEL: string };

/** Default embedding model per provider (ADR-007; 1024-d for both). */
export const DEFAULT_EMBEDDING_MODEL = {
  voyage: "voyage-3.5",
  bedrock: "amazon.titan-embed-text-v2:0",
} as const;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = result.data;
  return {
    ...c,
    EMBEDDING_MODEL: c.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL[c.EMBEDDING_PROVIDER],
  };
}

let cached: Config | undefined;

/** Parsed once per process from `process.env`. */
export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Throws a clear error when a secret needed by the current code path is missing. */
export function requireSetting<K extends keyof Config>(
  config: Config,
  key: K,
): NonNullable<Config[K]> {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required setting ${String(key)} (set it in .env.local)`);
  }
  return value as NonNullable<Config[K]>;
}
