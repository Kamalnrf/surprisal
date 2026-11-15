import { sentences } from "../../shared/stream.ts";
import type { Focus, Rule } from "../../shared/types.ts";

export type AnalysisStatus =
  | "paused"
  | "waiting"
  | "asking"
  | "failed"
  | "current"
  | "cached";

export const STATUS_LABEL: Record<AnalysisStatus, string> = {
  paused: "Not running",
  waiting: "Waiting for a pause",
  asking: "Asking Jev…",
  failed: "Failed",
  current: "Current",
  cached: "Cached",
};

export function analysisPause(
  focus: Focus,
  parsed: { rules: Rule[]; errors: string[] },
  analysisOn: boolean,
  editor: { composing: boolean; leaping: boolean },
): string {
  if (parsed.errors.length) {
    return parsed.errors.join(" ") +
      " Analysis is paused until the rules are fixed.";
  }
  if (focus.excluded) {
    return focus.section.tag === "@rules"
      ? `${parsed.rules.length} rules active. Only the bullets written here are checked. Edit or remove any rule.`
      : "This section is not analyzed. Write in another section to see observations.";
  }
  if (!analysisOn) return "Analysis is off. Your writing stays here.";
  if (!focus.text.trim()) {
    return "Write first. Pause, and observations will follow your paragraph.";
  }
  if (!parsed.rules.length) {
    return "No active rules. Start a section with @rules and add - or * bullets, or write @rules - a rule on any line.";
  }
  if (focus.text.length > 6000 || sentences(focus.text).length > 24) {
    return "Split this paragraph with a blank line to analyze it: up to 6,000 characters and 24 sentences per paragraph.";
  }
  if (editor.composing) return "Waiting for text composition to finish.";
  if (editor.leaping) return "Leap is open.";
  return "";
}
