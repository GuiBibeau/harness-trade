import type { SkillListItem } from "./skills-api";

export type SkillMention = {
  start: number;
  query: string;
};

export function findSkillMention(
  value: string,
  cursor: number,
): SkillMention | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const beforeCursor = value.slice(0, safeCursor);
  const match = beforeCursor.match(/(?:^|\s)@([a-z0-9-]*)$/i);
  if (!match) return null;
  return {
    start: beforeCursor.lastIndexOf("@"),
    query: match[1] ?? "",
  };
}
export function filterMentionedSkills(
  skills: readonly SkillListItem[],
  query: string,
): SkillListItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...skills];
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(normalized) ||
      skill.description.toLowerCase().includes(normalized),
  );
}

export function insertSkillMention(
  value: string,
  mention: SkillMention,
  cursor: number,
  skillName: string,
): { value: string; cursor: number } {
  const insertion = `@${skillName} `;
  const safeCursor = Math.max(mention.start, Math.min(cursor, value.length));
  return {
    value: `${value.slice(0, mention.start)}${insertion}${value.slice(safeCursor)}`,
    cursor: mention.start + insertion.length,
  };
}
