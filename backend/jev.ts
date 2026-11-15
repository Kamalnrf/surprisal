import { MODEL } from "../shared/stream.ts";
import type { Diagnostics } from "../shared/types.ts";

export class JevError extends Error {
  // Attached by analyze() so a failed run still shows what was sent.
  diagnostics?: Diagnostics;
  constructor(
    message: string,
    public status = 503,
    public scores: Record<string, number | null> = {},
  ) {
    super(message);
  }
}

export async function classify(
  key: string,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<{ scores: Record<string, number>; model: string }> {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({ model: MODEL, state, questions }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new JevError(
      response.status === 401 || response.status === 403
        ? "Jev rejected this API key. Change the key in Guide & privacy."
        : "Jev is unavailable. Your writing is unchanged; retry when ready.",
      response.status === 401 || response.status === 403 ? 401 : 503,
    );
  }
  const data = await response.json(),
    scores: Record<string, number | null> = {};
  let complete = true;
  for (const name of Object.keys(questions)) {
    const value = data.answers?.[name]?.noul;
    if (
      typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      value > 1
    ) {
      scores[name] = null;
      complete = false;
    } else scores[name] = value;
  }
  if (!complete) {
    throw new JevError(
      "Jev returned an incomplete check. No findings were accepted.",
      503,
      scores,
    );
  }
  return {
    scores: scores as Record<string, number>,
    model: data.model || MODEL,
  };
}
