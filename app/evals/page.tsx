import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

export const dynamic = "force-dynamic";

export interface ParsedSummarySection {
  title: string;
  lines: string[];
}

export function loadEvalSummary(
  file = path.join(process.cwd(), "evaluation/results/summary.md"),
): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "# Evaluation Summary\n\nNo evaluation summary found yet. Run `pnpm eval:fast` or `pnpm eval:full --mode both`.";
  }
}

export function parseMarkdownTables(md: string): {
  metaBullets: string[];
  tables: { heading: string; headers: string[]; rows: string[][] }[];
} {
  const lines = md.split(/\r?\n/);
  const metaBullets: string[] = [];
  const tables: { heading: string; headers: string[]; rows: string[][] }[] = [];

  let currentHeading = "Results";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) {
      currentHeading = line.replace(/^##\s+/, "");
      continue;
    }
    if (line.startsWith("- ")) {
      metaBullets.push(line.slice(2));
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.trim().startsWith("|---")) {
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = parseRow(line);
      i += 2; // skip separator row
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      i--;
      tables.push({ heading: currentHeading, headers, rows });
    }
  }

  return { metaBullets, tables };
}

export default function EvalsDashboardPage() {
  const md = loadEvalSummary();
  const { metaBullets, tables } = parseMarkdownTables(md);

  const categoryTable = tables.find((t) => /by category/i.test(t.heading));

  return (
    <main
      className="evals-page"
      style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "2rem 1.5rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#0f172a",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
          borderBottom: "1px solid #cbd5e1",
          paddingBottom: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Evaluation Dashboard</h1>
            <span className="badge badge-simulated">SIMULATED CORPUS</span>
          </div>
          <p style={{ margin: "0.35rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
            Live governance &amp; retrieval evaluation metrics parsed from{" "}
            <code>evaluation/results/summary.md</code>
          </p>
        </div>

        <nav aria-label="Dashboard navigation" style={{ display: "flex", gap: "0.5rem" }}>
          <a href="/" className="nav-pill-link">
            ← Copilot Chat
          </a>
          <a href="/approver" className="nav-pill-link">
            Approver Panel
          </a>
          <a href="/audit" className="nav-pill-link">
            Audit Log
          </a>
          <a
            href="https://github.com/actions"
            target="_blank"
            rel="noreferrer"
            className="nav-pill-link"
          >
            CI Workflows (eval-fast / eval-pr) ↗
          </a>
        </nav>
      </header>

      <section
        aria-label="Latest evaluation run metadata"
        style={{
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "0.5rem",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Latest Run Metadata</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6, fontSize: "0.9rem" }}>
          {metaBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </section>

      {categoryTable && (
        <section
          aria-label="Per-category recall bars"
          style={{
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "0.5rem",
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Per-Category Recall@5 Bars</h2>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {categoryTable.rows.map((row, idx) => {
              const category = row[0] ?? "";
              const mode = row[1] ?? "";
              const recallRaw = row[3] ?? "0%";
              const pct = Number.parseFloat(recallRaw.replace("%", ""));
              const validPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null;
              return (
                <div key={idx} style={{ fontSize: "0.85rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.2rem",
                    }}
                  >
                    <span>
                      <strong>{category}</strong> <span style={{ color: "#475569" }}>({mode})</span>
                    </span>
                    <span style={{ fontWeight: 600 }}>{recallRaw}</span>
                  </div>
                  {validPct !== null && (
                    <div
                      style={{
                        height: "8px",
                        background: "#e2e8f0",
                        borderRadius: "999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${validPct}%`,
                          height: "100%",
                          background: mode === "graphrag" ? "#0f766e" : "#64748b",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tables.map((t, tIdx) => (
        <section
          key={tIdx}
          style={{
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "0.5rem",
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            overflowX: "auto",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t.heading}</h2>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #cbd5e1", background: "#f1f5f9" }}>
                {t.headers.map((h, hIdx) => (
                  <th key={hIdx} style={{ padding: "0.5rem 0.65rem" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, rIdx) => (
                <tr key={rIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} style={{ padding: "0.45rem 0.65rem" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
