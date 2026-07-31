import { json } from "@sveltejs/kit";
import { BUILTIN_SKILLS } from "$agent/lib/builtin-skill-catalog";
import { SkillFormatException } from "$agent/lib/skill-format";
import {
  isSkillStoreConfigured,
  skillStore,
  type UserSkillSummary,
} from "$agent/lib/skill-store";
import { verifyPrivyAccessToken } from "$lib/server/privy";
import type { RequestHandler } from "./$types";

const BUILTINS = BUILTIN_SKILLS.map((skill) => ({
  ...skill,
  source: "builtin" as const,
  format: "agentskills" as const,
  enabled: true,
  loadSkillId: skill.name,
}));

async function requireUser(request: Request): Promise<string | Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return json({ error: "auth-required" }, { status: 401 });
  const userId = await verifyPrivyAccessToken(token);
  if (!userId) return json({ error: "auth-invalid" }, { status: 401 });
  return userId;
}

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  if (!isSkillStoreConfigured()) {
    return json({
      builtins: BUILTINS,
      userSkills: [],
      storeConfigured: false,
    });
  }

  try {
    const skills = await skillStore.list(user);
    return json({
      builtins: BUILTINS,
      userSkills: skillStore
        .summarize(skills)
        .map((skill: UserSkillSummary) => ({
          ...skill,
          source: "user" as const,
          format: "agentskills" as const,
          loadSkillId: `user-${skill.name}`,
        })),
      storeConfigured: true,
    });
  } catch {
    return json({ error: "skill-store-unavailable" }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  if (!isSkillStoreConfigured()) {
    return json({ error: "skill-store-unconfigured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const skillMd = typeof record.skillMd === "string" ? record.skillMd : "";
  const fallbackName =
    typeof record.name === "string" ? record.name.trim() : undefined;
  const enabled = record.enabled !== false;
  const files =
    record.files &&
    typeof record.files === "object" &&
    !Array.isArray(record.files)
      ? Object.fromEntries(
          Object.entries(record.files as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;

  try {
    const skill = await skillStore.install(user, {
      skillMd,
      files,
      fallbackName,
      enabled,
    });
    return json({
      skill: {
        ...skillStore.summarize([skill])[0],
        source: "user",
        format: "agentskills",
        loadSkillId: `user-${skill.name}`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof SkillFormatException) {
      return json({ error: error.code }, { status: 400 });
    }
    if (error instanceof Error && error.message === "skill-limit-reached") {
      return json({ error: "skill-limit-reached" }, { status: 409 });
    }
    return json({ error: "skill-store-unavailable" }, { status: 503 });
  }
};
