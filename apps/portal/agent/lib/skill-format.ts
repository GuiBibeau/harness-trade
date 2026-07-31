// Claude Agent Skills + OpenAI Codex skill package parsing.
// Shared Agent Skills standard: skill-name/SKILL.md with name + description.
// Codex optional sidecar: agents/openai.yaml (UI metadata only).
import { BUILTIN_SKILLS } from "./builtin-skill-catalog";

export const RESERVED_SKILL_NAMES = new Set<string>(
  BUILTIN_SKILLS.map((skill) => skill.name),
);

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_MARKDOWN_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 16 * 1024;
const MAX_FILES = 12;
const MAX_TOTAL_BYTES = 64 * 1024;

const ALLOWED_FILE_RE =
  /^(references\/[a-z0-9][a-z0-9._/-]*\.(md|txt|yaml|yml)|agents\/openai\.yaml)$/i;

export type ParsedSkillPackage = {
  name: string;
  description: string;
  markdown: string;
  files: Record<string, string>;
  openaiYaml: string | null;
};

export type SkillFormatError =
  | "invalid-skill-md"
  | "missing-name"
  | "invalid-name"
  | "reserved-name"
  | "missing-description"
  | "description-too-long"
  | "markdown-too-large"
  | "too-many-files"
  | "file-not-allowed"
  | "file-too-large"
  | "package-too-large"
  | "name-mismatch";

export class SkillFormatException extends Error {
  readonly code: SkillFormatError;
  constructor(code: SkillFormatError, message?: string) {
    super(message ?? code);
    this.name = "SkillFormatException";
    this.code = code;
  }
}

export function isAllowedSkillFilePath(path: string): boolean {
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return ALLOWED_FILE_RE.test(path);
}

export function parseSkillMarkdown(
  skillMd: string,
  options: { fallbackName?: string; expectName?: string } = {},
): ParsedSkillPackage {
  const trimmed = skillMd.replace(/^\uFEFF/, "");
  if (!trimmed.trim()) throw new SkillFormatException("invalid-skill-md");

  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new SkillFormatException("invalid-skill-md");

  const frontmatter = parseFrontmatter(match[1] ?? "");
  const markdown = (match[2] ?? "").trim();
  if (!markdown) throw new SkillFormatException("invalid-skill-md");

  const nameRaw =
    typeof frontmatter.name === "string"
      ? frontmatter.name.trim()
      : (options.fallbackName ?? "");
  if (!nameRaw) throw new SkillFormatException("missing-name");
  if (nameRaw.length > MAX_NAME || !SKILL_NAME_RE.test(nameRaw)) {
    throw new SkillFormatException("invalid-name");
  }
  if (RESERVED_SKILL_NAMES.has(nameRaw)) {
    throw new SkillFormatException("reserved-name");
  }
  if (options.expectName && options.expectName !== nameRaw) {
    throw new SkillFormatException("name-mismatch");
  }

  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim().replace(/\s+/g, " ")
      : "";
  if (!description) throw new SkillFormatException("missing-description");
  if (description.length > MAX_DESCRIPTION) {
    throw new SkillFormatException("description-too-long");
  }

  if (byteLength(markdown) > MAX_MARKDOWN_BYTES) {
    throw new SkillFormatException("markdown-too-large");
  }

  return {
    name: nameRaw,
    description,
    markdown,
    files: {},
    openaiYaml: null,
  };
}

export function assembleSkillPackage(input: {
  skillMd: string;
  files?: Record<string, string>;
  fallbackName?: string;
}): ParsedSkillPackage {
  const base = parseSkillMarkdown(input.skillMd, {
    fallbackName: input.fallbackName,
  });
  const files = normalizeFiles(input.files ?? {});
  const openaiYaml =
    typeof files["agents/openai.yaml"] === "string"
      ? files["agents/openai.yaml"]
      : null;
  const siblings = { ...files };
  delete siblings["agents/openai.yaml"];

  const total =
    byteLength(base.markdown) +
    Object.values(files).reduce((sum, value) => sum + byteLength(value), 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new SkillFormatException("package-too-large");
  }

  return {
    ...base,
    files: siblings,
    openaiYaml,
  };
}

export function toSkillMd(skill: {
  name: string;
  description: string;
  markdown: string;
}): string {
  return `---\nname: ${skill.name}\ndescription: >-\n  ${wrapDescription(skill.description)}\n---\n\n${skill.markdown.trim()}\n`;
}

function normalizeFiles(files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) {
    throw new SkillFormatException("too-many-files");
  }
  const out: Record<string, string> = {};
  for (const [rawPath, content] of entries) {
    const path = rawPath.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!isAllowedSkillFilePath(path)) {
      throw new SkillFormatException("file-not-allowed");
    }
    if (typeof content !== "string") {
      throw new SkillFormatException("file-not-allowed");
    }
    if (byteLength(content) > MAX_FILE_BYTES) {
      throw new SkillFormatException("file-too-large");
    }
    out[path] = content;
  }
  return out;
}

function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const folded = line.match(/^([A-Za-z0-9_-]+):\s*>-?\s*$/);
    if (folded) {
      const key = folded[1] ?? "";
      const parts: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (/^\S/.test(next) && next.includes(":")) break;
        parts.push(next.trim());
        i += 1;
      }
      out[key] = parts.filter(Boolean).join(" ");
      continue;
    }
    const simple = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (simple) {
      const key = simple[1] ?? "";
      let value = (simple[2] ?? "").trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    i += 1;
  }
  return out;
}

function wrapDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
