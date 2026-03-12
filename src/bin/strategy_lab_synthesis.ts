import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchSynthesisRequest } from "../runtime/research/synthesis.js";

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
    readArg("--output-dir") ?? ".tmp/strategy-lab-synthesis",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const briefFile = readArg("--brief-file");
  if (!briefFile) {
    throw new Error("missing-arg:--brief-file");
  }

  const requestBody = parseRuntimeResearchSynthesisRequest({
    brief: readJsonFile(resolve(briefFile)),
    ...(readArg("--strategy-key")
      ? { strategyKey: readArg("--strategy-key") }
      : {}),
    ...(readArg("--title") ? { title: readArg("--title") } : {}),
    ...(readArg("--preferred-venue")
      ? { preferredVenueKey: readArg("--preferred-venue") }
      : {}),
    ...(readArg("--market-type")
      ? { marketType: readArg("--market-type") }
      : {}),
  });

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/synthesis`,
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
        payload.error ?? `runtime-research-synthesis-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "synthesis.json");
  const markdownPath = join(outputDir, "synthesis.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload.synthesis, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        synthesisPath: jsonPath,
        markdownPath,
        synthesisId:
          typeof payload.synthesis === "object" && payload.synthesis
            ? (payload.synthesis as Record<string, unknown>).synthesisId
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
