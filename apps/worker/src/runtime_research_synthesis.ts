import type {
  RuntimeResearchSynthesisArtifact,
  RuntimeResearchSynthesisRequest,
} from "../../../src/runtime/research/synthesis.js";
import {
  buildRuntimeResearchSynthesis,
  buildRuntimeResearchSynthesisMarkdown,
} from "../../../src/runtime/research/synthesis.js";
import { writeRuntimeResearchHypothesis } from "./runtime_internal";
import type { Env } from "./types";

export type RuntimeResearchSynthesisWorkflowResult = {
  synthesis: RuntimeResearchSynthesisArtifact;
  markdown: string;
};

export async function runRuntimeResearchSynthesisWorkflow(input: {
  env: Env;
  request: RuntimeResearchSynthesisRequest;
}): Promise<RuntimeResearchSynthesisWorkflowResult> {
  const synthesis = buildRuntimeResearchSynthesis({
    request: input.request,
  });
  const response = await writeRuntimeResearchHypothesis({
    env: input.env,
    hypothesis: synthesis.hypothesis,
  });
  if (!response.ok) {
    throw new Error(
      String(
        response.payload.error ??
          "runtime-research-synthesis-hypothesis-write-failed",
      ),
    );
  }

  return {
    synthesis,
    markdown: buildRuntimeResearchSynthesisMarkdown(synthesis),
  };
}
