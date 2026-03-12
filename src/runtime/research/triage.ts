import {
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeStrategySpec,
  type RuntimeResearchHypothesisRecord,
  type RuntimeStrategySpec,
} from "../contracts/autonomous_runtime.js";
import { getRuntimeVenueCapability } from "../venues/catalog.js";
import type {
  RuntimeResearchImplementationPlan,
  RuntimeResearchSynthesisArtifact,
  RuntimeResearchSynthesisEvaluationPlan,
} from "./synthesis.js";

export type RuntimeResearchCandidateTriageRequest = {
  synthesis: RuntimeResearchSynthesisArtifact;
  existingHypotheses?: RuntimeResearchHypothesisRecord[];
  applyDisposition?: boolean;
};

export type RuntimeResearchCandidateDuplicateMatch = {
  matchType: "exact" | "near_duplicate" | "family_overlap";
  source: "builtin" | "candidate" | "production";
  strategyKey: string;
  similarityBps: number;
  reasons: string[];
};

export type RuntimeResearchCandidateTriageArtifact = {
  triageId: string;
  generatedAt: string;
  synthesisId: string;
  hypothesisId: string;
  disposition: "promote_to_candidate" | "review" | "archive";
  recommendedHypothesisStatus: RuntimeResearchHypothesisRecord["status"];
  noveltyScoreBps: number;
  evidenceScoreBps: number;
  venueFitScoreBps: number;
  implementationCostScoreBps: number;
  priorityScoreBps: number;
  duplicateMatches: RuntimeResearchCandidateDuplicateMatch[];
  rationale: string[];
  archivedHypothesisId?: string;
};

type StrategyReference = {
  strategyKey: string;
  title: string;
  category: RuntimeStrategySpec["category"];
  marketType: string;
  featureKeys: string[];
  regimeKeys: string[];
  tags: string[];
  source: "builtin" | "candidate" | "production";
};

const BUILTIN_STRATEGY_REFERENCES: StrategyReference[] = [
  reference(
    "dca",
    "DCA",
    "allocation",
    "spot",
    [],
    [],
    ["allocation"],
    "production",
  ),
  reference(
    "threshold_rebalance",
    "Threshold rebalance",
    "allocation",
    "spot",
    ["long_return_bps"],
    ["long_trend"],
    ["allocation", "rebalance"],
    "production",
  ),
  reference(
    "twap",
    "TWAP",
    "allocation",
    "spot",
    [],
    [],
    ["execution"],
    "production",
  ),
  reference(
    "trend_following",
    "Trend following",
    "signal",
    "spot",
    ["short_return_bps", "long_return_bps", "realized_volatility_bps"],
    ["short_trend", "long_trend"],
    ["trend", "signal"],
    "builtin",
  ),
  reference(
    "mean_reversion",
    "Mean reversion",
    "signal",
    "spot",
    ["short_return_bps", "spread_bps", "realized_volatility_bps"],
    ["volatility_band", "liquidity_state"],
    ["mean-reversion", "signal"],
    "builtin",
  ),
  reference(
    "breakout",
    "Breakout",
    "advanced",
    "spot",
    ["long_return_bps", "realized_volatility_bps", "spread_bps"],
    ["long_trend", "volatility_band"],
    ["advanced", "breakout"],
    "builtin",
  ),
  reference(
    "macro_rotation",
    "Macro rotation",
    "allocation",
    "spot",
    ["long_return_bps", "realized_volatility_bps"],
    ["long_trend", "volatility_band"],
    ["allocation", "rotation"],
    "builtin",
  ),
  reference(
    "volatility_target",
    "Volatility target",
    "advanced",
    "spot",
    ["realized_volatility_bps", "long_return_bps"],
    ["volatility_band"],
    ["advanced", "volatility"],
    "builtin",
  ),
];

const BUILTIN_FEATURE_KEYS = new Set([
  "short_return_bps",
  "long_return_bps",
  "realized_volatility_bps",
  "spread_bps",
]);

export function parseRuntimeResearchCandidateTriageRequest(
  input: unknown,
): RuntimeResearchCandidateTriageRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-request");
  }
  const synthesis = parseRuntimeResearchSynthesisArtifact(input.synthesis);
  const existingHypotheses = Array.isArray(input.existingHypotheses)
    ? input.existingHypotheses.map((entry) =>
        parseRuntimeResearchHypothesisRecord(entry),
      )
    : undefined;
  return {
    synthesis,
    ...(existingHypotheses ? { existingHypotheses } : {}),
    ...(typeof input.applyDisposition === "boolean"
      ? { applyDisposition: input.applyDisposition }
      : {}),
  };
}

export function buildRuntimeResearchCandidateTriage(input: {
  request: RuntimeResearchCandidateTriageRequest;
}): RuntimeResearchCandidateTriageArtifact {
  const synthesis = input.request.synthesis;
  const candidateReference = toReference(synthesis);
  const comparisons = [
    ...BUILTIN_STRATEGY_REFERENCES,
    ...(input.request.existingHypotheses ?? [])
      .filter(
        (hypothesis) =>
          hypothesis.hypothesisId !== synthesis.hypothesis.hypothesisId,
      )
      .map((hypothesis) => hypothesisToReference(hypothesis, synthesis)),
  ];
  const duplicateMatches = comparisons
    .map((reference) => compareReference(candidateReference, reference))
    .filter(
      (match): match is RuntimeResearchCandidateDuplicateMatch =>
        match !== null,
    )
    .sort((left, right) => right.similarityBps - left.similarityBps);

  const maxSimilarity = duplicateMatches[0]?.similarityBps ?? 0;
  const noveltyScoreBps = clampBps(10000 - maxSimilarity);
  const evidenceScoreBps = scoreEvidenceQuality(synthesis);
  const venueFitScoreBps = scoreVenueFit(synthesis);
  const implementationCostScoreBps = scoreImplementationCost(synthesis);
  const priorityScoreBps = clampBps(
    Math.round(
      noveltyScoreBps * 0.35 +
        evidenceScoreBps * 0.25 +
        venueFitScoreBps * 0.2 +
        implementationCostScoreBps * 0.2,
    ),
  );

  const rationale = buildRationale({
    duplicateMatches,
    noveltyScoreBps,
    evidenceScoreBps,
    venueFitScoreBps,
    implementationCostScoreBps,
    priorityScoreBps,
    synthesis,
  });
  const disposition = decideDisposition({
    duplicateMatches,
    evidenceScoreBps,
    venueFitScoreBps,
    priorityScoreBps,
  });
  const recommendedHypothesisStatus =
    disposition === "archive" ? "archived" : "candidate";
  const triageId = `triage_${hash(
    JSON.stringify({
      synthesisId: synthesis.synthesisId,
      hypothesisId: synthesis.hypothesis.hypothesisId,
      priorityScoreBps,
      maxSimilarity,
    }),
  )}`;

  return {
    triageId,
    generatedAt: new Date().toISOString(),
    synthesisId: synthesis.synthesisId,
    hypothesisId: synthesis.hypothesis.hypothesisId,
    disposition,
    recommendedHypothesisStatus,
    noveltyScoreBps,
    evidenceScoreBps,
    venueFitScoreBps,
    implementationCostScoreBps,
    priorityScoreBps,
    duplicateMatches,
    rationale,
  };
}

export function buildRuntimeResearchCandidateTriageMarkdown(
  triage: RuntimeResearchCandidateTriageArtifact,
): string {
  const lines = [
    `# Candidate triage for ${triage.hypothesisId}`,
    "",
    `- Triage id: ${triage.triageId}`,
    `- Generated at: ${triage.generatedAt}`,
    `- Disposition: ${triage.disposition}`,
    `- Recommended hypothesis status: ${triage.recommendedHypothesisStatus}`,
    `- Novelty score: ${formatBps(triage.noveltyScoreBps)}`,
    `- Evidence score: ${formatBps(triage.evidenceScoreBps)}`,
    `- Venue fit score: ${formatBps(triage.venueFitScoreBps)}`,
    `- Implementation cost score: ${formatBps(triage.implementationCostScoreBps)}`,
    `- Priority score: ${formatBps(triage.priorityScoreBps)}`,
    "",
    "## Rationale",
    "",
  ];

  for (const entry of triage.rationale) {
    lines.push(`- ${entry}`);
  }

  lines.push("", "## Duplicate Matches", "");
  if (triage.duplicateMatches.length === 0) {
    lines.push("- none");
  } else {
    for (const match of triage.duplicateMatches) {
      lines.push(
        `- ${match.strategyKey} (${match.source}, ${match.matchType}, ${formatBps(
          match.similarityBps,
        )})`,
      );
      for (const reason of match.reasons) {
        lines.push(`  ${reason}`);
      }
    }
  }

  return lines.join("\n");
}

function compareReference(
  candidate: StrategyReference,
  reference: StrategyReference,
): RuntimeResearchCandidateDuplicateMatch | null {
  const featureOverlap = jaccard(candidate.featureKeys, reference.featureKeys);
  const regimeOverlap = jaccard(candidate.regimeKeys, reference.regimeKeys);
  const tagOverlap = jaccard(candidate.tags, reference.tags);
  const titleOverlap = candidate.title === reference.title ? 10000 : 0;
  const categoryOverlap = candidate.category === reference.category ? 10000 : 0;
  const marketTypeOverlap =
    candidate.marketType === reference.marketType ? 10000 : 0;
  const similarityBps = clampBps(
    Math.round(
      featureOverlap * 0.35 +
        regimeOverlap * 0.2 +
        tagOverlap * 0.1 +
        titleOverlap * 0.2 +
        categoryOverlap * 0.1 +
        marketTypeOverlap * 0.05,
    ),
  );
  if (similarityBps < 3500) {
    return null;
  }

  const reasons: string[] = [];
  if (titleOverlap === 10000) {
    reasons.push("same synthesized title");
  }
  if (featureOverlap >= 6000) {
    reasons.push("high feature overlap");
  }
  if (regimeOverlap >= 5000) {
    reasons.push("high regime overlap");
  }
  if (candidate.category === reference.category) {
    reasons.push("same strategy category");
  }

  return {
    matchType:
      similarityBps >= 8500
        ? "exact"
        : similarityBps >= 6000
          ? "near_duplicate"
          : "family_overlap",
    source: reference.source,
    strategyKey: reference.strategyKey,
    similarityBps,
    reasons,
  };
}

function scoreEvidenceQuality(
  synthesis: RuntimeResearchSynthesisArtifact,
): number {
  const citationScore = Math.min(4000, synthesis.citations.length * 1500);
  const paperBonus = synthesis.citations.some((citation) =>
    citation.title.toLowerCase().includes("paper"),
  )
    ? 1500
    : 0;
  const recencyBonus = synthesis.hypothesis.sourceCitations.some((citation) =>
    (citation.notes ?? "").includes("published"),
  )
    ? 1500
    : 0;
  const riskPenalty = synthesis.riskNotes.some((note) =>
    note.toLowerCase().includes("requires new venue"),
  )
    ? 1500
    : 0;
  return clampBps(
    citationScore + paperBonus + recencyBonus + 1000 - riskPenalty,
  );
}

function scoreVenueFit(synthesis: RuntimeResearchSynthesisArtifact): number {
  const capability = getRuntimeVenueCapability(
    synthesis.evaluationPlan.venueKey,
  );
  if (!capability) {
    return 1500;
  }

  if (!capability.marketTypes.includes(synthesis.evaluationPlan.marketType)) {
    return 2000;
  }

  let score = 4500;
  score += 2500;
  if (capability.supportedModes.includes("shadow")) {
    score += 1000;
  }
  if (capability.supportedModes.includes("paper")) {
    score += 1000;
  }
  switch (capability.onboardingState) {
    case "broad_live_ready":
      score += 1000;
      break;
    case "paper_ready":
      score += 500;
      break;
    case "candidate":
      score -= 1500;
      break;
    default:
      score -= 500;
  }
  return clampBps(score);
}

function scoreImplementationCost(
  synthesis: RuntimeResearchSynthesisArtifact,
): number {
  let score = 9000;
  const unknownFeatureCount =
    synthesis.evaluationPlan.requiredFeatureKeys.filter(
      (featureKey) => !BUILTIN_FEATURE_KEYS.has(featureKey),
    ).length;
  score -= unknownFeatureCount * 1500;
  if (synthesis.evaluationPlan.marketType === "perp") {
    score -= 2500;
  }
  if (
    synthesis.implementationPlan.scaffoldFiles.some((file) =>
      file.path.includes("crates/execution-planner"),
    )
  ) {
    score -= 750;
  }
  return clampBps(score);
}

function buildRationale(input: {
  duplicateMatches: RuntimeResearchCandidateDuplicateMatch[];
  noveltyScoreBps: number;
  evidenceScoreBps: number;
  venueFitScoreBps: number;
  implementationCostScoreBps: number;
  priorityScoreBps: number;
  synthesis: RuntimeResearchSynthesisArtifact;
}): string[] {
  const lines = [
    `Novelty ${formatBps(input.noveltyScoreBps)} based on similarity against built-in and existing candidates.`,
    `Evidence ${formatBps(input.evidenceScoreBps)} from ${input.synthesis.citations.length} linked citations and published-source coverage.`,
    `Venue fit ${formatBps(input.venueFitScoreBps)} for ${input.synthesis.evaluationPlan.venueKey} ${input.synthesis.evaluationPlan.marketType}.`,
    `Implementation cost ${formatBps(input.implementationCostScoreBps)} based on required new features and market-type complexity.`,
    `Priority ${formatBps(input.priorityScoreBps)} after weighting novelty, evidence, venue fit, and implementation cost.`,
  ];
  if (input.duplicateMatches[0]) {
    lines.push(
      `Closest overlap is ${input.duplicateMatches[0].strategyKey} at ${formatBps(
        input.duplicateMatches[0].similarityBps,
      )}.`,
    );
  }
  return lines;
}

function decideDisposition(input: {
  duplicateMatches: RuntimeResearchCandidateDuplicateMatch[];
  evidenceScoreBps: number;
  venueFitScoreBps: number;
  priorityScoreBps: number;
}): RuntimeResearchCandidateTriageArtifact["disposition"] {
  const topMatch = input.duplicateMatches[0];
  if (topMatch && topMatch.matchType === "exact") {
    return "archive";
  }
  if (input.evidenceScoreBps < 3500 || input.venueFitScoreBps < 3000) {
    return "review";
  }
  if (input.priorityScoreBps < 4500) {
    return "review";
  }
  return "promote_to_candidate";
}

function toReference(
  synthesis: RuntimeResearchSynthesisArtifact,
): StrategyReference {
  return {
    strategyKey: synthesis.hypothesis.strategyKey,
    title: synthesis.hypothesis.title,
    category: synthesis.strategySpecDraft.category,
    marketType: synthesis.evaluationPlan.marketType,
    featureKeys: synthesis.evaluationPlan.requiredFeatureKeys,
    regimeKeys: synthesis.evaluationPlan.requiredRegimeKeys,
    tags: synthesis.strategySpecDraft.tags,
    source: "candidate",
  };
}

function hypothesisToReference(
  hypothesis: RuntimeResearchHypothesisRecord,
  synthesis: RuntimeResearchSynthesisArtifact,
): StrategyReference {
  return {
    strategyKey: hypothesis.strategyKey,
    title: hypothesis.title,
    category: synthesis.strategySpecDraft.category,
    marketType: synthesis.evaluationPlan.marketType,
    featureKeys: synthesis.evaluationPlan.requiredFeatureKeys,
    regimeKeys: synthesis.evaluationPlan.requiredRegimeKeys,
    tags: hypothesis.tags,
    source: "candidate",
  };
}

function parseRuntimeResearchSynthesisArtifact(
  input: unknown,
): RuntimeResearchSynthesisArtifact {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-synthesis-artifact");
  }
  return {
    synthesisId: readRequiredString(input.synthesisId, "synthesisId"),
    generatedAt: readRequiredString(input.generatedAt, "generatedAt"),
    briefId: readRequiredString(input.briefId, "briefId"),
    briefTitle: readRequiredString(input.briefTitle, "briefTitle"),
    expectedMechanism: readRequiredString(
      input.expectedMechanism,
      "expectedMechanism",
    ),
    hypothesis: parseRuntimeResearchHypothesisRecord(input.hypothesis),
    strategySpecDraft: parseRuntimeStrategySpec(input.strategySpecDraft),
    evaluationPlan: parseEvaluationPlan(input.evaluationPlan),
    implementationPlan: parseImplementationPlan(input.implementationPlan),
    riskNotes: normalizeStringArray(input.riskNotes),
    citations: Array.isArray(input.citations)
      ? input.citations.map((entry) => parseCitation(entry))
      : [],
  };
}

function parseEvaluationPlan(
  input: unknown,
): RuntimeResearchSynthesisEvaluationPlan {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-evaluation-plan");
  }
  return {
    marketType: readRequiredString(
      input.marketType,
      "evaluationPlan.marketType",
    ) as RuntimeResearchSynthesisEvaluationPlan["marketType"],
    venueKey: readRequiredString(input.venueKey, "evaluationPlan.venueKey"),
    pairSymbol: readRequiredString(
      input.pairSymbol,
      "evaluationPlan.pairSymbol",
    ),
    assetKeys: normalizeStringArray(input.assetKeys),
    datasetRequirements: normalizeStringArray(input.datasetRequirements),
    requiredFeatureKeys: normalizeStringArray(input.requiredFeatureKeys),
    requiredRegimeKeys: normalizeStringArray(input.requiredRegimeKeys),
    backtestPlan: isRecord(input.backtestPlan)
      ? {
          windowMode: "rolling",
          trainingWindowObservations: readRequiredNumber(
            input.backtestPlan.trainingWindowObservations,
            "evaluationPlan.backtestPlan.trainingWindowObservations",
          ),
          testingWindowObservations: readRequiredNumber(
            input.backtestPlan.testingWindowObservations,
            "evaluationPlan.backtestPlan.testingWindowObservations",
          ),
          stepObservations: readRequiredNumber(
            input.backtestPlan.stepObservations,
            "evaluationPlan.backtestPlan.stepObservations",
          ),
          purgeObservations: readRequiredNumber(
            input.backtestPlan.purgeObservations,
            "evaluationPlan.backtestPlan.purgeObservations",
          ),
          baselineStrategies: normalizeStringArray(
            input.backtestPlan.baselineStrategies,
          ),
        }
      : (() => {
          throw new Error("invalid-runtime-research-triage-backtest-plan");
        })(),
    paperPlan: isRecord(input.paperPlan)
      ? {
          required: true,
          minPaperRuns: readRequiredNumber(
            input.paperPlan.minPaperRuns,
            "evaluationPlan.paperPlan.minPaperRuns",
          ),
          notes: normalizeStringArray(input.paperPlan.notes),
        }
      : (() => {
          throw new Error("invalid-runtime-research-triage-paper-plan");
        })(),
    successCriteria: normalizeStringArray(input.successCriteria),
    failureModes: normalizeStringArray(input.failureModes),
  };
}

function parseImplementationPlan(
  input: unknown,
): RuntimeResearchImplementationPlan {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-implementation-plan");
  }
  return {
    branchName: readRequiredString(
      input.branchName,
      "implementationPlan.branchName",
    ),
    issueTitle: readRequiredString(
      input.issueTitle,
      "implementationPlan.issueTitle",
    ),
    issueBody: readRequiredString(
      input.issueBody,
      "implementationPlan.issueBody",
    ),
    scaffoldFiles: Array.isArray(input.scaffoldFiles)
      ? input.scaffoldFiles.map((entry) =>
          parsePlanEntry(entry, "scaffoldFiles"),
        )
      : [],
    testFiles: Array.isArray(input.testFiles)
      ? input.testFiles.map((entry) => parsePlanEntry(entry, "testFiles"))
      : [],
    validationCommands: normalizeStringArray(input.validationCommands),
  };
}

function parsePlanEntry(
  input: unknown,
  label: string,
): RuntimeResearchImplementationPlan["scaffoldFiles"][number] {
  if (!isRecord(input)) {
    throw new Error(`invalid-runtime-research-triage-${label}`);
  }
  return {
    path: readRequiredString(input.path, `${label}.path`),
    purpose: readRequiredString(input.purpose, `${label}.purpose`),
  };
}

function parseCitation(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-citation");
  }
  return {
    sourceId: readRequiredString(input.sourceId, "citation.sourceId"),
    title: readRequiredString(input.title, "citation.title"),
    canonicalUrl: readRequiredString(
      input.canonicalUrl,
      "citation.canonicalUrl",
    ),
  };
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = Array.from(leftSet).filter((value) =>
    rightSet.has(value),
  ).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) {
    return 0;
  }
  return clampBps(Math.round((intersection / union) * 10000));
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function clampBps(value: number): number {
  return Math.max(0, Math.min(10000, Math.trunc(value)));
}

function reference(
  strategyKey: string,
  title: string,
  category: RuntimeStrategySpec["category"],
  marketType: string,
  featureKeys: string[],
  regimeKeys: string[],
  tags: string[],
  source: StrategyReference["source"],
): StrategyReference {
  return {
    strategyKey,
    title,
    category,
    marketType,
    featureKeys,
    regimeKeys,
    tags,
    source,
  };
}

function readRequiredString(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(`invalid-runtime-research-triage-${field}`);
  }
  return input.trim();
}

function readRequiredNumber(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`invalid-runtime-research-triage-${field}`);
  }
  return Math.trunc(input);
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hash(value: string): string {
  let hashValue = 0;
  for (let index = 0; index < value.length; index += 1) {
    hashValue = (hashValue * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hashValue.toString(16).padStart(8, "0");
}
