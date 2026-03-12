import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchCandidateTriageRequest } from "../runtime/research/triage.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-lab-triage",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const synthesisFile = readArg("--synthesis-file");
  if (!synthesisFile) {
    throw new Error("missing-arg:--synthesis-file");
  }

  const requestBody = parseRuntimeResearchCandidateTriageRequest({
    synthesis: readJsonFile(resolve(synthesisFile)),
    ...(process.argv.includes("--apply-disposition")
      ? { applyDisposition: true }
      : {}),
  });

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/triage`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      String(
        payload.error ?? `runtime-research-triage-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "triage.json");
  const markdownPath = join(outputDir, "triage.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload.triage, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        triagePath: jsonPath,
        markdownPath,
        triageId:
          typeof payload.triage === "object" && payload.triage
            ? (payload.triage as Record<string, unknown>).triageId
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
