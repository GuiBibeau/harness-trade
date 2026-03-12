import { parseRuntimeResearchHypothesisRecord } from "../../../src/runtime/contracts/autonomous_runtime.js";
import type {
  RuntimeResearchCandidateTriageArtifact,
  RuntimeResearchCandidateTriageRequest,
} from "../../../src/runtime/research/triage.js";
import {
  buildRuntimeResearchCandidateTriage,
  buildRuntimeResearchCandidateTriageMarkdown,
} from "../../../src/runtime/research/triage.js";
import {
  readRuntimeResearchRegistry,
  writeRuntimeResearchHypothesis,
} from "./runtime_internal";
import type { Env } from "./types";

export type RuntimeResearchTriageWorkflowResult = {
  triage: RuntimeResearchCandidateTriageArtifact;
  markdown: string;
};

export async function runRuntimeResearchCandidateTriageWorkflow(input: {
  env: Env;
  request: RuntimeResearchCandidateTriageRequest;
}): Promise<RuntimeResearchTriageWorkflowResult> {
  const registryResponse = await readRuntimeResearchRegistry({
    env: input.env,
  });
  if (!registryResponse.ok) {
    throw new Error(
      String(
        registryResponse.payload.error ??
          "runtime-research-triage-registry-read-failed",
      ),
    );
  }

  const rawHypotheses =
    registryResponse.payload.registry &&
    typeof registryResponse.payload.registry === "object" &&
    Array.isArray(registryResponse.payload.registry.hypotheses)
      ? registryResponse.payload.registry.hypotheses
      : [];
  const existingHypotheses = rawHypotheses
    .map((entry) => {
      try {
        return parseRuntimeResearchHypothesisRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        value,
      ): value is RuntimeResearchCandidateTriageRequest["existingHypotheses"][number] =>
        value !== null,
    );

  const triage = buildRuntimeResearchCandidateTriage({
    request: {
      ...input.request,
      existingHypotheses,
    },
  });

  let archivedHypothesisId: string | undefined;
  if (
    input.request.applyDisposition &&
    triage.recommendedHypothesisStatus === "archived" &&
    input.request.synthesis.hypothesis.status !== "archived"
  ) {
    const archivedHypothesis = parseRuntimeResearchHypothesisRecord({
      ...input.request.synthesis.hypothesis,
      status: "archived",
      updatedAt: triage.generatedAt,
      tags: Array.from(
        new Set([
          ...input.request.synthesis.hypothesis.tags,
          "archived",
          "triaged",
        ]),
      ).slice(0, 16),
    });
    const archiveResponse = await writeRuntimeResearchHypothesis({
      env: input.env,
      hypothesis: archivedHypothesis,
    });
    if (!archiveResponse.ok) {
      throw new Error(
        String(
          archiveResponse.payload.error ??
            "runtime-research-triage-archive-failed",
        ),
      );
    }
    archivedHypothesisId = archivedHypothesis.hypothesisId;
  }

  return {
    triage: {
      ...triage,
      ...(archivedHypothesisId ? { archivedHypothesisId } : {}),
    },
    markdown: buildRuntimeResearchCandidateTriageMarkdown({
      ...triage,
      ...(archivedHypothesisId ? { archivedHypothesisId } : {}),
    }),
  };
}
