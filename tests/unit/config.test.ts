import { describe, expect, it } from "vitest";
import { parseConfig, requireSetting } from "@/lib/config";

describe("config", () => {
  it("applies ADR-010 model defaults and the ADR-007 embedding default", () => {
    const c = parseConfig({});
    expect(c.MODEL_PROVIDER).toBe("anthropic");
    expect(c.ROUTER_MODEL).toBe("claude-haiku-5-5");
    expect(c.ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(c.JUDGE_MODEL).toBe("claude-opus-5-5");
    expect(c.EMBEDDING_MODEL).toBe("voyage-3.5");
    expect(c.APPROVAL_ENGINE).toBe("in-memory");
  });

  it("keeps the embedding model independent of MODEL_PROVIDER", () => {
    const c = parseConfig({ MODEL_PROVIDER: "bedrock" });
    expect(c.EMBEDDING_PROVIDER).toBe("voyage");
    expect(c.EMBEDDING_MODEL).toBe("voyage-3.5");
  });

  it("coerces numeric settings and treats empty strings as unset", () => {
    const c = parseConfig({ SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY: "6", VOYAGE_API_KEY: "" });
    expect(c.SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY).toBe(6);
    expect(c.VOYAGE_API_KEY).toBeUndefined();
  });

  it("rejects an unknown provider", () => {
    expect(() => parseConfig({ MODEL_PROVIDER: "openai" })).toThrow(/MODEL_PROVIDER/);
  });

  it("requireSetting names the missing key", () => {
    expect(() => requireSetting(parseConfig({}), "DATABASE_URL")).toThrow(/DATABASE_URL/);
  });
});
