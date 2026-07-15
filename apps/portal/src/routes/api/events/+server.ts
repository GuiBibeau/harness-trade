// Telemetry ingest: append event batches as day-partitioned NDJSON blobs
// (events/YYYY-MM-DD/<iso>-<rand>.ndjson). Blob-per-batch keeps writes
// contention-free and the corpus is a trivial glob-and-concat for training.
// Without BLOB_READ_WRITE_TOKEN (dev/preview) the endpoint accepts and
// discards, so clients never error and no local setup is required.

import { put } from "@vercel/blob";
import type { RequestHandler } from "./$types";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_EVENTS = 200;

export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 202 });
  }
  let events: unknown;
  try {
    events = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 202 });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(null, { status: 202 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return new Response(null, { status: 202 });

  const receivedAt = new Date();
  const lines = events
    .slice(0, MAX_EVENTS)
    .map((event) =>
      JSON.stringify({ ...(event as object), _rx: receivedAt.getTime() }),
    )
    .join("\n");
  const day = receivedAt.toISOString().slice(0, 10);
  const name = `events/${day}/${receivedAt.toISOString()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.ndjson`;
  try {
    // Private on purpose, twice over: event payloads can carry wallet
    // addresses, and the connected store (ralph-private) only accepts
    // private writes — a "public" put throws and silently drops the batch.
    await put(name, `${lines}\n`, {
      access: "private",
      contentType: "application/x-ndjson",
      token,
    });
  } catch {
    // Sink write failed — still 202: telemetry must never surface errors
    // into the trading client.
  }
  return new Response(null, { status: 202 });
};
