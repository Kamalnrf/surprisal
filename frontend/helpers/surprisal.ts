import type { SurprisalResult } from "../../shared/types.ts";

export async function readSurprisal(
  text: string,
  signal: AbortSignal,
): Promise<SurprisalResult> {
  const response = await fetch("/api/surprisal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    // A sleeping GPU takes up to a minute to wake.
    signal: AbortSignal.any([signal, AbortSignal.timeout(125000)]),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error || "Surprisal unavailable. Your writing is unchanged.",
    );
  }
  return response.json();
}
