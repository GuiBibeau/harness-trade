export const BUILTIN_SKILLS = [
  {
    name: "skill-installer",
    description:
      "Design and install a focused Agent Skill from a plain-language request.",
    hasOpenaiYaml: true,
  },
  {
    name: "plan-trade",
    description:
      "Plan, execute, and verify a trade or position-management request without inventing transaction parameters.",
    hasOpenaiYaml: true,
  },
  {
    name: "create-routine",
    description:
      "Create or change a recurring market review, alert, or bounded position-management Routine and its optional Mandate.",
    hasOpenaiYaml: true,
  },
] as const;
