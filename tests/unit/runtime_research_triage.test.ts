import { describe, expect, test } from "bun:test";
import { buildRuntimeResearchSynthesis } from "../../src/runtime/research/synthesis.js";
import {
  buildRuntimeResearchCandidateTriage,
  buildRuntimeResearchCandidateTriageMarkdown,
  parseRuntimeResearchCandidateTriageRequest,
} from "../../src/runtime/research/triage.js";

const briefFixture = {
  briefId: "brief_latest_signal",
  generatedAt: "2026-03-11T12:00:00.000Z",
  profile: "custom",
  title: "Latest signal research",
  summary:
    "Reviewed 1 approved source across 1 acquisition request. Most recent coverage: Momentum Alpha in Crypto.",
  findings: [
    "Momentum Alpha in Crypto (published 2026-03-11T08:00:00.000Z): Measure momentum across venue fragments and validate liquidity persistence.",
  ],
  approvedHosts: ["research.example.com"],
  requestCount: 1,
  sourceCount: 1,
  createdCount: 1,
  existingCount: 0,
  citations: [
    {
      sourceId: "source_article_momentum",
      materialDigest: "sha256:source_article_momentum",
      notes: "published 2026-03-11T08:00:00.000Z",
    },
  ],
  sources: [
    {
      sourceId: "source_article_momentum",
      sourceKind: "article",
      title: "Momentum Alpha in Crypto",
      url: "https://research.example.com/posts/momentum-alpha",
      canonicalUrl: "https://research.example.com/posts/momentum-alpha",
      authors: ["Ada Researcher"],
      publishedAt: "2026-03-11T08:00:00.000Z",
      retrievedAt: "2026-03-11T12:00:00.000Z",
      venueKeys: ["jupiter"],
      assetKeys: ["SOL", "USDC"],
      tags: ["signal", "momentum"],
      digest: "sha256:source_article_momentum",
    },
  ],
} as const;

describe("runtime research triage", () => {
  test("parses triage requests with a synthesis artifact", () => {
    const synthesis = buildRuntimeResearchSynthesis({
      request: {
        brief: briefFixture,
      },
    });

    const request = parseRuntimeResearchCandidateTriageRequest({
      synthesis,
      applyDisposition: true,
    });

    expect(request.applyDisposition).toBe(true);
    expect(request.synthesis.synthesisId).toBe(synthesis.synthesisId);
  });

  test("detects duplicate trend candidates and recommends archival", () => {
    const synthesis = buildRuntimeResearchSynthesis({
      request: {
        brief: briefFixture,
      },
    });

    const triage = buildRuntimeResearchCandidateTriage({
      request: {
        synthesis,
      },
    });

    expect(triage.duplicateMatches.length).toBeGreaterThan(0);
    expect(triage.disposition).toBe("archive");
    expect(triage.recommendedHypothesisStatus).toBe("archived");

    const markdown = buildRuntimeResearchCandidateTriageMarkdown(triage);
    expect(markdown).toContain("## Duplicate Matches");
    expect(markdown).toContain("trend_following");
  });

  test("keeps novel perp carry candidates in review instead of archival", () => {
    const synthesis = buildRuntimeResearchSynthesis({
      request: {
        brief: {
          ...briefFixture,
          title: "Perp funding dislocations",
          summary:
            "Reviewed 1 approved source covering basis, funding, and perp carry.",
          findings: [
            "Perp carry stays attractive when funding and basis dislocations persist.",
          ],
          sources: [
            {
              ...briefFixture.sources[0],
              title: "Perp carry and basis dislocations",
              tags: ["perp", "funding", "carry"],
            },
          ],
        },
      },
    });

    const triage = buildRuntimeResearchCandidateTriage({
      request: {
        synthesis,
      },
    });

    expect(triage.disposition).toBe("review");
    expect(triage.noveltyScoreBps).toBeGreaterThan(4000);
    expect(triage.implementationCostScoreBps).toBeLessThan(7000);
  });
});
