import { describe, expect, test } from "bun:test";
import {
  buildRuntimeResearchSynthesis,
  buildRuntimeResearchSynthesisMarkdown,
  parseRuntimeResearchSynthesisRequest,
} from "../../src/runtime/research/synthesis.js";

const briefFixture = {
  briefId: "brief_latest_signal",
  generatedAt: "2026-03-11T12:00:00.000Z",
  profile: "custom",
  title: "Latest signal research",
  summary:
    "Reviewed 2 approved sources across 1 acquisition request. Most recent coverage: Momentum Alpha in Crypto; Liquidity-aware trend continuation.",
  findings: [
    "Momentum Alpha in Crypto (published 2026-03-11T08:00:00.000Z): Measure momentum across venue fragments and validate liquidity persistence.",
    "Liquidity-aware trend continuation (published 2026-03-10T08:00:00.000Z): Trend continuation improves when spread remains contained.",
  ],
  approvedHosts: ["research.example.com"],
  requestCount: 1,
  sourceCount: 2,
  createdCount: 2,
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

describe("runtime research synthesis", () => {
  test("parses synthesis requests with a brief artifact", () => {
    const request = parseRuntimeResearchSynthesisRequest({
      brief: briefFixture,
      strategyKey: "custom_candidate",
      preferredVenueKey: "jupiter",
      marketType: "spot",
    });

    expect(request.strategyKey).toBe("custom_candidate");
    expect(request.brief.briefId).toBe("brief_latest_signal");
    expect(request.marketType).toBe("spot");
  });

  test("builds a candidate hypothesis, spec draft, and implementation plan", () => {
    const synthesis = buildRuntimeResearchSynthesis({
      request: parseRuntimeResearchSynthesisRequest({
        brief: briefFixture,
      }),
    });

    expect(synthesis.hypothesis.status).toBe("candidate");
    expect(synthesis.hypothesis.strategyKey).toContain("trend_following");
    expect(synthesis.strategySpecDraft.category).toBe("signal");
    expect(synthesis.evaluationPlan.requiredFeatureKeys).toContain(
      "short_return_bps",
    );
    expect(synthesis.implementationPlan.issueTitle).toContain("[Candidate]");
    expect(synthesis.implementationPlan.scaffoldFiles[0]?.path).toBe(
      "crates/strategy-core/src/lib.rs",
    );

    const markdown = buildRuntimeResearchSynthesisMarkdown(synthesis);
    expect(markdown).toContain("# Trend following");
    expect(markdown).toContain("## Failure Modes");
    expect(markdown).toContain("Momentum Alpha in Crypto");
  });

  test("switches to perp synthesis when funding keywords dominate", () => {
    const synthesis = buildRuntimeResearchSynthesis({
      request: parseRuntimeResearchSynthesisRequest({
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
      }),
    });

    expect(synthesis.evaluationPlan.marketType).toBe("perp");
    expect(synthesis.strategySpecDraft.category).toBe("advanced");
    expect(synthesis.evaluationPlan.requiredFeatureKeys).toContain(
      "funding_rate_bps",
    );
  });
});
