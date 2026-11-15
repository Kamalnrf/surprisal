import { sentences, validRules } from "../../shared/stream.ts";
import type { AnalysisInput } from "../../shared/types.ts";
import { analyze } from "../analysis.ts";
import { JevError } from "../jev.ts";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function analyzeRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Origin not allowed" }, 403);
  }
  const key = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)
    ?.[1];
  if (!key) {
    return json({ error: "Provide your Jev API key to analyze writing." }, 401);
  }
  const raw = await request.text();
  if (raw.length > 1048576) return json({ error: "Request too large" }, 413);
  let input: AnalysisInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (
    typeof input?.paragraph !== "string" || !input.paragraph.trim() ||
    input.paragraph.length > 6000 || sentences(input.paragraph).length > 24
  ) {
    return json({
      error:
        "Use up to 6,000 characters and 24 sentences in the current paragraph. Your draft is not limited.",
    }, 400);
  }
  if (
    !input.context ||
    [input.context.before, input.context.after].some((v) =>
      typeof v !== "string" || v.length > 1500
    ) || !validRules(input.rules)
  ) {
    return json({ error: "Invalid context or rules" }, 400);
  }
  try {
    return json(await analyze(key, input));
  } catch (error) {
    // Keep expected upstream failures actionable; unexpected errors reach H3's logger.
    if (error instanceof JevError) {
      return json(
        { error: error.message, diagnostics: error.diagnostics },
        error.status,
      );
    }
    throw error;
  }
}
