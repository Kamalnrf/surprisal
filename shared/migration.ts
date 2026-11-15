import { BREAK, GUIDE } from "./stream.ts";
import { STARTER_RULES } from "./rules.ts";

// This historical shape is used only to recover old saved rules, never for analysis.
interface LegacyRule {
  id: string;
  kind: "order" | "reference" | "observation";
  mode: "constraint" | "hypothesis";
  name: string;
  instruction: string;
  enabled?: boolean;
}

export function validLegacyRules(rules: unknown): rules is LegacyRule[] {
  return Array.isArray(rules) &&
    new Set(rules.map((r) => r?.id)).size === rules.length &&
    rules.every((r) =>
      r && typeof r.id === "string" && /^[a-z0-9-]{1,50}$/.test(r.id) &&
      ["order", "reference", "observation"].includes(r.kind) &&
      ["constraint", "hypothesis"].includes(r.mode) &&
      typeof r.name === "string" && r.name.trim().length > 0 &&
      r.name.length <= 80 && typeof r.instruction === "string" &&
      r.instruction.trim().length > 0 && r.instruction.length <= 500
    );
}

export function migrateStream(
  draft: string | null,
  savedRules: unknown,
): string {
  if (draft === null && savedRules === null) {
    return STARTER_RULES + BREAK + GUIDE + BREAK;
  }
  const saved = validLegacyRules(savedRules) ? savedRules : [
    {
      instruction:
        "Notice a sentence that supplies background or explanation for concrete actions elsewhere in this paragraph.",
      enabled: true,
    },
    {
      instruction:
        "Notice a sentence whose pronoun or reference relies on an earlier sentence to be understood.",
      enabled: true,
    },
  ];
  const active = saved.filter((r) => r.enabled !== false),
    inactive = saved.filter((r) => r.enabled === false);
  return (draft ?? "") + BREAK + "@rules\n\n" +
    active.map((r) => "- " + r.instruction.replace(/\r?\n/g, " ")).join(
      "\n\n",
    ) +
    (inactive.length
      ? BREAK +
        "@inactive-rules\n\nMove a bullet into @rules to activate it.\n\n" +
        inactive.map((r) => "- " + r.instruction.replace(/\r?\n/g, " ")).join(
          "\n\n",
        )
      : "");
}
