import { fetchWithPrivyAuth } from "$lib/privy-fetch";

export type SkillListItem = {
  name: string;
  description: string;
  enabled: boolean;
  source: "builtin" | "user";
  format: "agentskills";
  loadSkillId: string;
  hasOpenaiYaml?: boolean;
  fileCount?: number;
  updatedAt?: string;
};

export type SkillsListResponse = {
  builtins: SkillListItem[];
  userSkills: SkillListItem[];
  storeConfigured: boolean;
};

const JSON_HEADERS = { "content-type": "application/json" };

export async function fetchAgentSkills(): Promise<SkillsListResponse> {
  const response = await fetchWithPrivyAuth("/api/agent/skills", {
    headers: JSON_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`skills-list-${response.status}`);
  }
  return (await response.json()) as SkillsListResponse;
}

export async function installAgentSkill(input: {
  skillMd: string;
  name?: string;
  files?: Record<string, string>;
  enabled?: boolean;
}): Promise<SkillListItem> {
  const response = await fetchWithPrivyAuth("/api/agent/skills", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as {
    skill?: SkillListItem;
    error?: string;
  };
  if (!response.ok || !body.skill) {
    throw new Error(body.error ?? `skills-install-${response.status}`);
  }
  return body.skill;
}

export async function setAgentSkillEnabled(
  name: string,
  enabled: boolean,
): Promise<SkillListItem> {
  const response = await fetchWithPrivyAuth(
    `/api/agent/skills/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled }),
    },
  );
  const body = (await response.json()) as {
    skill?: SkillListItem;
    error?: string;
  };
  if (!response.ok || !body.skill) {
    throw new Error(body.error ?? `skills-patch-${response.status}`);
  }
  return body.skill;
}

export async function deleteAgentSkill(name: string): Promise<void> {
  const response = await fetchWithPrivyAuth(
    `/api/agent/skills/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: JSON_HEADERS,
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `skills-delete-${response.status}`);
  }
}
