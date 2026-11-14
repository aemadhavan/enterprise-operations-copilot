/**
 * Amazon Bedrock model provider (T068, FR-025, R-01, R-05).
 * Uses AnthropicBedrockMantle with explicit AWS region, model mapping,
 * and client-side refusal fallback middleware for environments where
 * server-side fallbacks are not supported natively.
 */

import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@/lib/config";
import type { CreateParams, Effort, ModelRole } from "./index";

export interface BedrockModelClientOptions {
  role: ModelRole;
  model: string;
  effort: Effort;
  awsRegion: string;
  client?: AnthropicBedrockMantle;
}

/**
 * Client-side refusal fallback middleware (R-05):
 * If Bedrock returns a refusal stop_reason or refusal error, catches and routes to a safe default.
 */
export async function withBedrockRefusalFallback<T extends { stop_reason?: string | null }>(
  call: () => Promise<T>,
  fallbackProducer?: () => Promise<T>,
): Promise<T> {
  try {
    const res = await call();
    if (res?.stop_reason === "refusal" && fallbackProducer) {
      return await fallbackProducer();
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b(refusal|content_filter|blocked)\b/i.test(message) && fallbackProducer) {
      return await fallbackProducer();
    }
    throw err;
  }
}

export function createBedrockClient(
  role: ModelRole,
  config: Pick<
    Config,
    "AWS_REGION" | "BEDROCK_ROUTER_MODEL_ID" | "BEDROCK_MODEL_ID" | "JUDGE_MODEL"
  >,
  customClient?: AnthropicBedrockMantle,
) {
  const model =
    role === "router"
      ? config.BEDROCK_ROUTER_MODEL_ID
      : role === "agent"
        ? config.BEDROCK_MODEL_ID
        : `anthropic.${config.JUDGE_MODEL}`;
  const effort: Effort = role === "router" ? "low" : "medium";
  const sdk = customClient ?? new AnthropicBedrockMantle({ awsRegion: config.AWS_REGION });

  return {
    role,
    provider: "bedrock" as const,
    model,
    effort,
    async create(params: CreateParams): Promise<Anthropic.Message> {
      return withBedrockRefusalFallback(async () => {
        const body: Record<string, unknown> = { ...params };
        delete body.temperature;
        delete body.top_p;
        delete body.top_k;
        body.model = model;
        body.output_config = { ...(params.output_config ?? {}), effort };
        return (await sdk.messages.create(body as never)) as Anthropic.Message;
      });
    },
  };
}
