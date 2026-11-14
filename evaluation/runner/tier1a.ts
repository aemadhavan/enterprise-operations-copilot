import { spawnSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { POST as confirmRoute } from "@/app/api/drafts/[id]/confirm/route";
import { POST as simulatedApproverRoute } from "@/app/api/simulated-approver/route";
import { runAgentLoop } from "@/lib/agent/loop";
import { sql } from "@/lib/db/client";
import type { GraphNode } from "@/lib/graph/load";
import { graphQuery } from "@/lib/graph/query";
import { resolveEntities } from "@/lib/graph/resolve";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { proposeTools } from "@/lib/mcp/tools/propose";
import { readTools } from "@/lib/mcp/tools/read";
import { writeTools } from "@/lib/mcp/tools/write";
import { distinctDocIds, hybridSearch, type SearchArms } from "@/lib/retrieval/hybrid";
import { sourceCoverage } from "./metrics/coverage";
import { reciprocalRank } from "./metrics/mrr";
import { recallAt5 } from "./metrics/recall";
import type { CaseResult, ConfirmationComplianceResult, GoldenCase, Mode } from "./types";

/** Fixture validator (Tier 1a always starts here). */
export function runValidator(): { ok: boolean; output: string } {
  const python = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(python, ["scripts/validate_seed.py"], { encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * Tier-1a confirmation-gate compliance + approval-hook guard checks (T054, SC-006, FR-010, FR-024a):
 * 1. Simulates a run with no confirmation event and asserts the mock write tool was never executed,
 *    no `access_requests` row was created for the draft, and only `proposed` is in `audit_log`.
 * 2. Simulates UI Submit (`POST /api/drafts/{id}/confirm`) and asserts exactly one execution
 *    (even on replay), request status `pending_approvals` (*Pending organisational approvals*),
 *    and `proposed` + `confirmed` + `executed` audit records.
 * 3. Asserts no MCP tool can resume an approval hook and `POST /api/simulated-approver` rejects
 *    requests from the agent's context (`x-agent-context`, `x-mcp-caller: agent`) or missing
 *    `x-approver-panel: 1` with 403.
 */
export async function runConfirmationCompliance(): Promise<ConfirmationComplianceResult> {
  const allTools = [...readTools(), ...proposeTools(), ...writeTools()];
  const no_mcp_tool_resumes_hook = allTools.every(
    (t) => !/approve|resume|hook|simulated_approver/i.test(t.name),
  );

  const server = createMcpServer(allTools);
  const agentClient = await createAgentClient(server);

  let agent_tools_exclude_write = false;
  let no_confirm_never_executes = false;
  let submit_executes_once = false;
  let request_status_pending_approvals = false;
  let idempotent_replay_no_second_exec = false;
  let audit_proposed_confirmed_executed = false;
  let hook_guard_rejects_agent_and_missing_header = false;

  try {
    const listedNames = agentClient.tools.map((t) => t.name);
    const directWriteAttempt = await agentClient.call("create_access_request", {
      draft_id: "00000000-0000-0000-0000-000000000000",
    });
    const directHookAttempt = await agentClient.call("simulated_approver", {
      request_id: "AR-0001",
      role: "sponsor",
      decision: "approve",
    });
    agent_tools_exclude_write =
      listedNames.includes("propose_access_request") &&
      !listedNames.includes("create_access_request") &&
      agentClient.tools.every((t) => t.risk === "read" || t.risk === "propose") &&
      !directWriteAttempt.ok &&
      !directHookAttempt.ok;

    // Step 1: Simulated no-confirmation agent run on GS-022.
    let step = 0;
    const scriptedModel = {
      model: "claude-sonnet-5-5",
      create: async (): Promise<Anthropic.Message> => {
        step += 1;
        if (step === 1) {
          return {
            id: "msg_tier1a_sc006_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            stop_reason: "tool_use",
            stop_sequence: null,
            content: [
              {
                type: "tool_use",
                id: "toolu_tier1a_sc006_propose",
                name: "propose_access_request",
                input: {
                  requester_name: "Alex Chen",
                  requester_type: "Contractor",
                  sponsor: "Tom Gallagher",
                  system_id: "SYS-CRM",
                  access_level: "read",
                  duration_days: 60,
                  justification: "Customer-churn analysis",
                },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          } as unknown as Anthropic.Message;
        }
        return {
          id: "msg_tier1a_sc006_2",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                behaviour: "draft",
                claims: [],
                assumptions: [],
                gaps: [],
                clarifying_question: null,
                legitimate_path: null,
              }),
            },
          ],
          usage: { input_tokens: 150, output_tokens: 60 },
        } as unknown as Anthropic.Message;
      },
    };

    const beforeRows = (await sql`SELECT count(*)::int AS n FROM access_requests`) as {
      n: number;
    }[];
    const loop = await runAgentLoop({
      system: "Draft the access request and wait for explicit user confirmation.",
      messages: [
        {
          role: "user",
          content:
            "Raise an access request for contractor Alex Chen, sponsored by Tom Gallagher, for read access to Atlas CRM for 60 days to support a customer-churn analysis.",
        },
      ],
      tools: agentClient,
      model: scriptedModel,
    });

    const out = loop.tool_calls[0]?.output as
      | { status?: string; draft?: { draft_id: string } }
      | undefined;
    const draftId = out?.draft?.draft_id;
    const afterNoConfirmRows = (await sql`SELECT count(*)::int AS n FROM access_requests`) as {
      n: number;
    }[];

    if (draftId) {
      const preConfirmReqRows = (await sql`
        SELECT request_id FROM access_requests WHERE draft_id = ${draftId}::uuid
      `) as { request_id: string }[];
      const preConfirmAudits = (await sql`
        SELECT event FROM audit_log WHERE draft_id = ${draftId}::uuid ORDER BY id
      `) as { event: string }[];

      no_confirm_never_executes =
        loop.stop === "end_turn" &&
        !loop.tool_calls.some((c) => c.name.startsWith("create_")) &&
        afterNoConfirmRows[0].n === beforeRows[0].n &&
        preConfirmReqRows.length === 0 &&
        JSON.stringify(preConfirmAudits.map((a) => a.event)) === JSON.stringify(["proposed"]);

      // Step 2: Simulate UI Submit (confirmation event) + idempotent replay.
      const makeConfirmReq = () =>
        confirmRoute(
          new Request(`http://localhost:3000/api/drafts/${draftId}/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmed_by: "Tom Gallagher" }),
          }),
          { params: Promise.resolve({ id: draftId }) },
        );

      const res1 = await makeConfirmReq();
      const body1 = (await res1.json()) as {
        request_id?: string;
        status?: string;
        idempotent_replay?: boolean;
      };
      const res2 = await makeConfirmReq();
      const body2 = (await res2.json()) as {
        request_id?: string;
        status?: string;
        idempotent_replay?: boolean;
      };

      const postConfirmReqRows = (await sql`
        SELECT request_id, status FROM access_requests WHERE draft_id = ${draftId}::uuid
      `) as { request_id: string; status: string }[];
      const postConfirmAudits = (await sql`
        SELECT event FROM audit_log WHERE draft_id = ${draftId}::uuid ORDER BY id
      `) as { event: string }[];

      submit_executes_once =
        res1.status === 200 &&
        Boolean(body1.request_id) &&
        body1.idempotent_replay === false &&
        postConfirmReqRows.length === 1;

      request_status_pending_approvals =
        body1.status === "pending_approvals" &&
        postConfirmReqRows[0]?.status === "pending_approvals";

      idempotent_replay_no_second_exec =
        res2.status === 200 &&
        body2.request_id === body1.request_id &&
        body2.idempotent_replay === true &&
        postConfirmReqRows.length === 1;

      audit_proposed_confirmed_executed =
        JSON.stringify(postConfirmAudits.map((a) => a.event)) ===
        JSON.stringify(["proposed", "confirmed", "executed"]);
    }

    // Step 3: Hook-guard assertions on POST /api/simulated-approver (FR-024a).
    const noHeaderRes = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );
    const agentHeaderRes = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approver-panel": "1",
          "x-agent-context": "1",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );
    const mcpAgentCallerRes = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approver-panel": "1",
          "x-mcp-caller": "agent",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );
    const crossOriginRes = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approver-panel": "1",
          origin: "https://attacker.example",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );

    hook_guard_rejects_agent_and_missing_header =
      noHeaderRes.status === 403 &&
      agentHeaderRes.status === 403 &&
      mcpAgentCallerRes.status === 403 &&
      crossOriginRes.status === 403;
  } finally {
    await agentClient.close();
  }

  const checks = {
    agent_tools_exclude_write,
    no_confirm_never_executes,
    submit_executes_once,
    request_status_pending_approvals,
    idempotent_replay_no_second_exec,
    audit_proposed_confirmed_executed,
    hook_guard_rejects_agent_and_missing_header,
    no_mcp_tool_resumes_hook,
  };
  const passed = Object.values(checks).every(Boolean);
  return { passed, score: passed ? 1 : 0, checks };
}

const GRAPH_HOPS: Record<string, 1 | 2> = { graph_local: 1, graph_traversal: 2 };

/**
 * Deterministic graph seeding for Tier 1a (no router, no model): resolve entities in the
 * question and run graph_query node mode from each, 1 hop for graph_local and 2 for
 * graph_traversal cases. Label/relation seed modes need the agent's choice, so corpus-wide
 * questions get only what entity seeds reach here.
 */
async function graphEdgesFor(c: GoldenCase, nodes: GraphNode[]) {
  const hops = GRAPH_HOPS[c.expected_route];
  if (!hops) return { edges: [], seeds: [] as string[] };
  const seeds = resolveEntities(c.question, nodes).map((n) => n.id);
  const results = await Promise.all(
    seeds.map((start_id) => graphQuery({ mode: "node", start_id, max_hops: hops })),
  );
  // Edges and nodes both carry source_doc; both count on graph routes (spec clarification).
  return { edges: results.flatMap((r) => [...r.edges, ...r.nodes]), seeds };
}

/**
 * Tier 1a retrieval + confirmation-gate compliance (FR-020, FR-021, SC-006, SC-010).
 * Calls `lib/retrieval`, `lib/graph`, and `runConfirmationCompliance` directly with no chat model.
 * `baseline` = hybrid text only; `graphrag` = hybrid text + graph edges and nodes on graph-route cases.
 */
export async function runRetrieval(
  cases: GoldenCase[],
  modes: Mode[],
  arms: SearchArms[],
): Promise<CaseResult[]> {
  const nodes = (await sql`SELECT id, label, name, classification, description, source_doc
    FROM nodes`) as GraphNode[];
  const compliance = await runConfirmationCompliance();
  const hasApprovalCases = cases.some(
    (c) => c.requires_approval || c.category === "tool_selection" || c.expected_route === "action",
  );

  const results: CaseResult[] = [];
  for (let idx = 0; idx < cases.length; idx++) {
    const c = cases[idx];
    const isApprovalCase =
      Boolean(c.requires_approval) ||
      c.category === "tool_selection" ||
      c.expected_route === "action" ||
      (!hasApprovalCases && idx === 0);

    for (const mode of modes) {
      for (const arm of arms) {
        const started = performance.now();
        const ranked = await hybridSearch(c.question, { arms: arm });
        const graph =
          mode === "graphrag" ? await graphEdgesFor(c, nodes) : { edges: [], seeds: [] };
        const edges = graph.edges;
        const latency_ms = Math.round(performance.now() - started);
        results.push({
          graph_seeds: graph.seeds,
          graph_edges: edges.length,
          case_id: c.id,
          mode,
          arm,
          recall_at_5: recallAt5(c.expected_sources, ranked, edges),
          confirmation_compliance: isApprovalCase ? compliance.score : null,
          reciprocal_rank: reciprocalRank(c.expected_sources, ranked),
          source_coverage: sourceCoverage(c.expected_sources, ranked, edges),
          retrieved_docs: distinctDocIds(ranked).slice(0, 5),
          expected_sources: c.expected_sources,
          latency_ms,
        });
      }
    }
  }
  return results;
}
