import { ScorerError, surprisal } from "../surprisal.ts";
import { json } from "./analysis.ts";

export async function surprisalRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Origin not allowed" }, 403);
  }
  const raw = await request.text();
  if (raw.length > 20000) return json({ error: "Request too large" }, 413);
  let input: { text?: unknown };
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { text } = input;
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    return json(
      { error: "Surprisal reads up to 4,000 characters at once." },
      400,
    );
  }
  try {
    return json(await surprisal(text));
  } catch (error) {
    if (error instanceof ScorerError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}
