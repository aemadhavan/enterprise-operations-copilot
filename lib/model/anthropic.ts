import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";

/** The slice of the SDK surface we use; both clients expose `messages.create`. */
export interface MessagesSdk {
  messages: { create(body: never): Promise<unknown> };
}

export interface SdkFactory {
  anthropic(opts: { apiKey?: string }): MessagesSdk;
  bedrock(opts: { awsRegion: string }): MessagesSdk;
}

/** Real SDK constructors. Credentials: ANTHROPIC_API_KEY / AWS default chain. */
export const realSdkFactory: SdkFactory = {
  anthropic: ({ apiKey }) => new Anthropic(apiKey ? { apiKey } : {}) as unknown as MessagesSdk,
  bedrock: ({ awsRegion }) => new AnthropicBedrockMantle({ awsRegion }) as unknown as MessagesSdk,
};
