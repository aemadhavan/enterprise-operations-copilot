import type Anthropic from "@anthropic-ai/sdk";
import { getConfig, type Config } from "@/lib/config";
import { realSdkFactory, type SdkFactory } from "./anthropic";

export type { SdkFactory } from "./anthropic";

/** Model tiering (ADR-010): router = Haiku, agent/answers = Sonnet, judge = Opus. */
export type ModelRole = "router" | "agent" | "judge";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Explicit effort per role (R-01, R-03). Never rely on model defaults. */
export const ROLE_EFFORT: Record<ModelRole, Effort> = {
  router: "low",
  agent: "medium",
  judge: "medium",
};

/** Sampling params are never sent (R-03); the API also rejects them on these models. */
const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"] as const;

/** Request body without the fields the wrapper owns (model, effort, sampling). */
export type CreateParams = Omit<
  Anthropic.MessageCreateParamsNonStreaming,
  "model" | (typeof SAMPLING_PARAMS)[number]
>;

export interface ModelClient {
  role: ModelRole;
  provider: "anthropic" | "bedrock";
  model: string;
  effort: Effort;
  create(params: CreateParams): Promise<Anthropic.Message>;
}

function resolve(role: ModelRole, config: Config) {
  const provider = role === "judge" ? config.JUDGE_PROVIDER : config.MODEL_PROVIDER;
  if (provider === "bedrock") {
    const model =
      role === "router"
        ? config.BEDROCK_ROUTER_MODEL_ID
        : role === "agent"
          ? config.BEDROCK_MODEL_ID
          : `anthropic.${config.JUDGE_MODEL}`;
    return { provider, model } as const;
  }
  const model =
    role === "router"
      ? config.ROUTER_MODEL
      : role === "agent"
        ? config.ANTHROPIC_MODEL
        : config.JUDGE_MODEL;
  return { provider, model } as const;
}

/** Provider-neutral client for one role, with the role's model ID and effort fixed. */
export function createClient(
  role: ModelRole,
  opts: { config?: Config; factory?: SdkFactory } = {},
): ModelClient {
  const config = opts.config ?? getConfig();
  const factory = opts.factory ?? realSdkFactory;
  const { provider, model } = resolve(role, config);
  const effort = ROLE_EFFORT[role];
  const sdk =
    provider === "bedrock"
      ? factory.bedrock({ awsRegion: config.AWS_REGION })
      : factory.anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  return {
    role,
    provider,
    model,
    effort,
    async create(params) {
      const body: Record<string, unknown> = { ...params };
      for (const p of SAMPLING_PARAMS) delete body[p];
      body.model = model;
      body.output_config = { ...(params.output_config ?? {}), effort };
      return (await sdk.messages.create(body as never)) as Anthropic.Message;
    },
  };
}
