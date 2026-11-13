import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "@/lib/config";
import { createClient, ROLE_EFFORT, type SdkFactory } from "@/lib/model";

function fakeFactory() {
  const create = vi.fn(async (body: Record<string, unknown>) => ({ body }));
  const factory: SdkFactory = {
    anthropic: vi.fn(() => ({ messages: { create } })),
    bedrock: vi.fn(() => ({ messages: { create } })),
  };
  return { factory, create };
}

describe("model provider (FR-025, ADR-010)", () => {
  it("maps each role to its model ID and explicit effort on Anthropic", () => {
    const config = parseConfig({});
    const { factory } = fakeFactory();
    expect(createClient("router", { config, factory })).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "low",
    });
    expect(createClient("agent", { config, factory })).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    expect(createClient("judge", { config, factory })).toMatchObject({
      model: "claude-opus-5-5",
      effort: "medium",
    });
    expect(ROLE_EFFORT).toEqual({ router: "low", agent: "medium", judge: "medium" });
  });

  it("selects Bedrock (Mantle) model IDs and region when MODEL_PROVIDER=bedrock", () => {
    const config = parseConfig({ MODEL_PROVIDER: "bedrock", AWS_REGION: "ap-southeast-2" });
    const { factory } = fakeFactory();
    expect(createClient("router", { config, factory })).toMatchObject({
      provider: "bedrock",
      model: "anthropic.claude-haiku-5-5",
    });
    expect(createClient("agent", { config, factory }).model).toBe("anthropic.claude-sonnet-5-5");
    expect(factory.bedrock).toHaveBeenCalledWith({ awsRegion: "ap-southeast-2" });
    expect(factory.anthropic).not.toHaveBeenCalled();
  });

  it("uses JUDGE_PROVIDER for the judge, independent of MODEL_PROVIDER", () => {
    const config = parseConfig({ MODEL_PROVIDER: "bedrock", JUDGE_PROVIDER: "anthropic" });
    const { factory } = fakeFactory();
    expect(createClient("judge", { config, factory })).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
  });

  it("sends the role's model and effort and never sends sampling params", async () => {
    const { factory, create } = fakeFactory();
    const client = createClient("router", { config: parseConfig({}), factory });
    await client.create({
      max_tokens: 256,
      messages: [{ role: "user", content: "hi" }],
      // A caller trying to sneak these in is stripped, not forwarded (R-03).
      ...({ temperature: 0, top_p: 0.9, top_k: 5 } as object),
    });
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("keeps a caller's output_config.format while forcing the role effort", async () => {
    const { factory, create } = fakeFactory();
    const client = createClient("agent", { config: parseConfig({}), factory });
    const format = { type: "json_schema", schema: { type: "object" } };
    await client.create({
      max_tokens: 1000,
      messages: [{ role: "user", content: "hi" }],
      output_config: { format, effort: "max" } as never,
    });
    expect(create.mock.calls[0][0].output_config).toEqual({ format, effort: "medium" });
  });
});
