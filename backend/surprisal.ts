import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import type { SurprisalResult } from "../shared/types.ts";

// The scorer is a GPU on Modal; every call costs money, so the public
// endpoint is capped per day and spaced out across all visitors.
const DAILY_CALLS = 1500;
const MIN_GAP_MS = 250;

export class ScorerError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
  }
}

let signingKey: CryptoKey | undefined;

async function allow() {
  const now = Date.now();
  const name = "surprisal:" + new Date(now).toISOString().slice(0, 10);
  // One conditional statement, so simultaneous requests cannot both pass.
  const counted = await sqlite.execute({
    sql:
      "INSERT INTO allowance (name, calls, last_ms) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET calls = calls + 1, last_ms = excluded.last_ms WHERE allowance.calls < ? AND excluded.last_ms - allowance.last_ms >= ?",
    args: [name, now, DAILY_CALLS, MIN_GAP_MS],
  });
  if (counted.rowsAffected) return;
  const row = (await sqlite.execute({
    sql: "SELECT calls FROM allowance WHERE name = ?",
    args: [name],
  })).rows[0];
  throw new ScorerError(
    Number(row?.calls) >= DAILY_CALLS
      ? "Surprisal has used today's allowance. Writing is unaffected."
      : "Too many requests. Pause, then try again.",
    429,
  );
}

/** Signs the request with the key whose public half is pinned in scorer.py. */
export async function surprisal(text: string): Promise<SurprisalResult> {
  const endpoint = Deno.env.get("SCORER_URL");
  if (!endpoint) throw new ScorerError("The surprisal scorer is not set up.");
  await allow();
  if (!signingKey) {
    const row =
      (await sqlite.execute("SELECT private FROM identity WHERE id=1")).rows[0];
    signingKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(String(row.private)),
      "Ed25519",
      false,
      ["sign"],
    );
  }
  const body = JSON.stringify({
    text,
    timestamp: Date.now() / 1000,
    nonce: crypto.randomUUID(),
  });
  const signature = btoa(String.fromCharCode(
    ...new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        signingKey,
        new TextEncoder().encode(body),
      ),
    ),
  ));
  // A cold GPU takes 30–60 s to load the model.
  const response = await fetch(endpoint + "/surprisal", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    throw new ScorerError(
      response.status === 422
        ? "This passage is too long to read at once."
        : "The surprisal model is unavailable. Your writing is unchanged.",
      response.status === 422 ? 400 : 503,
    );
  }
  return response.json();
}
