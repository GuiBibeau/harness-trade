import { describe, expect, test } from "bun:test";
import {
  filterMentionedSkills,
  findSkillMention,
  insertSkillMention,
} from "./skill-mentions";
import type { SkillListItem } from "./skills-api";

const skills: SkillListItem[] = [
  {
    name: "skill-installer",
    description: "Create a reusable skill",
    enabled: true,
    source: "builtin",
    format: "agentskills",
    loadSkillId: "skill-installer",
  },
  {
    name: "paper-risk",
    description: "Review leverage and position risk",
    enabled: true,
    source: "user",
    format: "agentskills",
    loadSkillId: "user-paper-risk",
  },
];

describe("agent skill mentions", () => {
  test("opens only for an @ token at the cursor", () => {
    expect(findSkillMention("review @paper", 13)).toEqual({
      start: 7,
      query: "paper",
    });
    expect(findSkillMention("email@example.com", 17)).toBeNull();
    expect(findSkillMention("use @paper later", 16)).toBeNull();
  });

  test("filters by skill name or description", () => {
    expect(filterMentionedSkills(skills, "install")[0]?.name).toBe(
      "skill-installer",
    );
    expect(filterMentionedSkills(skills, "leverage")[0]?.name).toBe(
      "paper-risk",
    );
  });

  test("replaces the active token and preserves the rest of the draft", () => {
    expect(
      insertSkillMention(
        "use @pap for SOL",
        { start: 4, query: "pap" },
        8,
        "paper-risk",
      ),
    ).toEqual({
      value: "use @paper-risk  for SOL",
      cursor: 16,
    });
  });
});
