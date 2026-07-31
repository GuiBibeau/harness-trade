import { json } from "@sveltejs/kit";
import { verifyPrivyAccessToken } from "./privy";

export async function requireAgentUser(
  request: Request,
): Promise<string | Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return json({ error: "auth-required" }, { status: 401 });
  const userId = await verifyPrivyAccessToken(token);
  return userId ? userId : json({ error: "auth-invalid" }, { status: 401 });
}

export async function readJsonRecord(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : json({ error: "invalid-body" }, { status: 400 });
}
