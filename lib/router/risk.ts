import type { Intent } from "@/lib/agent/schemas";
import type { GraphNode } from "@/lib/graph/load";

export type Risk = "low" | "high";

/**
 * Risk is computed in code, never by the model (FR-003, contracts/answer-schema.md):
 * high for action and unsafe intents, or when any resolved System or DataClass is Restricted.
 */
export function computeRisk(
  intent: Intent,
  entities: Pick<GraphNode, "label" | "classification">[],
): Risk {
  if (intent === "action" || intent === "unsafe") return "high";
  const restricted = entities.some(
    (e) => (e.label === "System" || e.label === "DataClass") && e.classification === "Restricted",
  );
  return restricted ? "high" : "low";
}
