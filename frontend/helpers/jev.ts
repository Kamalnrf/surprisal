import type {
  AnalysisErrorBody,
  AnalysisInput,
  AnalysisResult,
  Diagnostics,
} from "../../shared/types.ts";

export class AnalysisError extends Error {
  constructor(message: string, public diagnostics?: Diagnostics) {
    super(message);
  }
}

export async function askJev(
  input: AnalysisInput,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const response = await fetch("/api/annotate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(input),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
      : AbortSignal.timeout(40000),
  });
  if (!response.ok) {
    const data: AnalysisErrorBody | null = await response.json().catch(() =>
      null
    );
    throw new AnalysisError(
      data?.error || "Analysis unavailable. Your writing is unchanged.",
      data?.diagnostics,
    );
  }
  return response.json();
}
