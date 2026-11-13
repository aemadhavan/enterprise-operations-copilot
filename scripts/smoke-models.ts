// Live smoke test: one tiny call per role through createClient (ADR-010). Costs well under $0.01.
import "./_env";
import { createClient, type ModelRole } from "@/lib/model";

const roles: ModelRole[] = ["router", "agent", "judge"];
let failed = false;

for (const role of roles) {
  const client = createClient(role);
  const started = performance.now();
  try {
    const res = await client.create({
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    const ms = Math.round(performance.now() - started);
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text.trim()] : [])).join(" ");
    const u = res.usage;
    console.log(
      `${role.padEnd(6)} ${client.provider}/${res.model} effort=${client.effort} ${ms}ms ` +
        `in=${u.input_tokens} out=${u.output_tokens} stop=${res.stop_reason} reply=${JSON.stringify(text)}`,
    );
  } catch (err) {
    failed = true;
    console.error(`${role.padEnd(6)} ${client.model} FAILED: ${(err as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
