import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentPrincipal } from "../lib/auth";
import { skillStore } from "../lib/skill-store";

export default defineTool({
  description:
    "Install or update one user-owned Agent Skill after the user explicitly asks to create or install it. Accept only SKILL.md and optional non-executable reference files.",
  inputSchema: z.object({
    skillMd: z
      .string()
      .min(1)
      .max(32_768)
      .describe("Complete SKILL.md including YAML frontmatter."),
    files: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Optional references/*.md|txt|yaml and agents/openai.yaml files. Scripts are not allowed.",
      ),
  }),
  async execute(input, ctx) {
    const principal = requireAgentPrincipal(ctx);
    const skill = await skillStore.install(principal.userId, {
      skillMd: input.skillMd,
      files: input.files,
      enabled: true,
    });
    return {
      installed: true,
      skill: {
        name: skill.name,
        mention: `@${skill.name}`,
        description: skill.description,
        enabled: skill.enabled,
        updatedAt: skill.updatedAt,
      },
    };
  },
});
