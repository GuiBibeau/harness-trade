import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentPrincipal } from "../lib/auth";
import { BUILTIN_SKILLS } from "../lib/builtin-skill-catalog";
import { skillStore } from "../lib/skill-store";

export default defineTool({
  description:
    "List the authenticated user's installed Agent Skills (Claude / Codex SKILL.md packages), including disabled ones.",
  inputSchema: z.object({
    includeDisabled: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const principal = requireAgentPrincipal(ctx);
    const skills = await skillStore.list(principal.userId);
    const rows = (
      input.includeDisabled ? skills : skills.filter((skill) => skill.enabled)
    ).map((skill) => ({
      name: skill.name,
      loadSkillId: `user-${skill.name}`,
      description: skill.description,
      enabled: skill.enabled,
      updatedAt: skill.updatedAt,
      hasOpenaiYaml: skill.openaiYaml !== null,
      fileCount: Object.keys(skill.files).length,
    }));
    return {
      builtins: BUILTIN_SKILLS.map(({ name, description }) => ({
        name,
        description,
      })),
      userSkills: rows,
    };
  },
});
