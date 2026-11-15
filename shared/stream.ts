import type {
  AnalysisInput,
  Focus,
  Observation,
  Paragraph,
  ParagraphFocus,
  Rule,
  Section,
  Sentence,
} from "./types.ts";

export const VERSION = "lint-3";
export const MODEL = "jev-latest";
export const THRESHOLD = 0.8;

export function paragraphs(text: string): Paragraph[] {
  const parts = [];
  let start = 0;
  for (const m of text.matchAll(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/g)) {
    parts.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  parts.push({ start, end: text.length, text: text.slice(start) });
  return parts;
}
export function focusAt(text: string, position: number): ParagraphFocus {
  const parts = paragraphs(text);
  let index = parts.findIndex((_p, i) =>
    position < (parts[i + 1]?.start ?? text.length + 1)
  );
  if (index < 0) index = parts.length - 1;
  return {
    ...parts[index],
    index,
    context: {
      before: (parts[index - 1]?.text || "").slice(-1500),
      after: (parts[index + 1]?.text || "").slice(0, 1500),
    },
  };
}
export function sentences(text: string): Sentence[] {
  return [
    ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text),
  ].map((s) => {
    const leading = s.segment.length - s.segment.trimStart().length;
    const quote = s.segment.trim();
    return {
      start: s.index + leading,
      end: s.index + leading + quote.length,
      text: quote,
    };
  }).filter((s) => s.text).map((s, id) => ({ ...s, id }));
}
export function requestKey(input: AnalysisInput): string {
  return JSON.stringify([
    VERSION,
    MODEL,
    input.paragraph,
    input.context.before,
    input.context.after,
    input.rules,
  ]);
}
export function validRules(rules: unknown): rules is Rule[] {
  return Array.isArray(rules) &&
    new Set(rules.map((r) => r?.id)).size === rules.length &&
    rules.every((r) =>
      r && typeof r.id === "string" && /^[a-z0-9-]{1,50}$/.test(r.id) &&
      typeof r.instruction === "string" &&
      r.instruction.trim().length > 0 && r.instruction.length <= 500
    );
}
export function observations(
  paragraph: string,
  rules: Rule[],
  scores: Record<string, number>,
): Observation[] {
  const parts = sentences(paragraph), result: Observation[] = [];
  for (let r = 0; r < rules.length; r++) {
    const rule = rules[r];
    for (const sentence of parts) {
      if (!(scores["r" + r + "s" + sentence.id] >= THRESHOLD)) continue;
      result.push({
        ruleId: rule.id,
        sentenceId: sentence.id,
        quote: sentence.text,
        start: sentence.start,
        end: sentence.end,
      });
      break; // A single, source-ordered observation per rule; no fluctuating score ranking.
    }
  }
  return result;
}
export function escapeHTML(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      } as Record<string, string>)[c],
  );
}

// A form-feed on its own line is an explicit document break, not typed dashes.
export const BREAK = "\n\f\n";
export const GUIDE = `@guide

# Surprisal

Write anywhere. Saved in this browser, not synced.

## Sections
- New section: ⌘Enter / Ctrl+Enter, or + Section on touch.
- Mark places with \`@names\`.

## Leap
- Tap left Option/Alt to leap backward, right to leap forward.
- Type to leap, tap either key again to move to the next match.
- Enter lands. Esc / Ctrl+C returns.
- On touch: tap a match to land, tap Leap again to cancel.

## Variants
- Select writing, then type an alternative in the margin.
- ⌘Shift+Enter moves focus into the variants list.
- Click marked writing to reopen its list.
- Return starts a draft, Shift+Return adds a line break.
- ↑ / ↓ switch versions. Esc returns to the writing.

## Surprisal
- Warm marks: words the model would have written itself. Click one to see what it expected, then type your own word as a variant.
- Underlines: stock phrases the model finished for you. Dashed when it only echoes your earlier words.
- The margin rates each sentence: expected, half-expected or unexpected. Hover for the model's odds; click to rewrite it as a variant.
- A line of just \`@ignore\` skips the next line. \`@ignore\` before text skips that line.

## Markdown
- \`# heading\`, \`**bold**\`, \`*italic*\`, \`~~strike~~\`, \`> quote\`, \`- list\`, tables, links and images.
- \`- [ ]\` makes a task; tap its box to tick it. Type \`[]\` and a space for a new one.
- ⌘B bold, ⌘I italic, ⌘K link, ⌘-click opens a link, Tab indents a list item.
- Quotes curl and \`--\` becomes a dash; Backspace right after undoes it.
- Code, tables and images are not read by Surprisal.

## Rules
- \`@rules\` on a section's first line makes each bullet a rule. The next break ends them.
- Or write \`@rules - a rule\` on any line.
- \`@ignore\` above or before a rule switches it off.

## Privacy
- Observations are possibilities, not mistakes.
- Surprisal sends the current and previous paragraph to our model.
- Rules send nearby writing to Jev. Add an optional Jev key in Writing settings → Guide & privacy, where you can also download backups.`;
export function sections(text: string): Section[] {
  const out = [];
  let start = 0;
  for (const match of text.matchAll(/^\f\r?$/gm)) {
    out.push({ start, end: match.index, text: text.slice(start, match.index) });
    start = match.index + match[0].length;
    if (text[start] === "\n") start++;
  }
  out.push({ start, end: text.length, text: text.slice(start) });
  return out.map((part, index) => ({
    ...part,
    index,
    tag: part.text.trimStart().split(/\r?\n/)[0].trim(),
  }));
}
export function sectionAt(text: string, pos: number): Section {
  const parts = sections(text);
  return parts.find((_s, i) =>
    pos < (parts[i + 1]?.start ?? text.length + 1)
  ) ||
    parts.at(-1)!;
}
export function streamFocus(text: string, pos: number): Focus {
  const section = sectionAt(text, pos),
    focus = focusAt(section.text, Math.max(0, pos - section.start));
  return {
    ...focus,
    start: focus.start + section.start,
    end: focus.end + section.start,
    section,
    excluded: ["@rules", "@guide", "@inactive-rules"].includes(section.tag),
  };
}
// Like ts-ignore: "@ignore" alone on a line skips it and the next non-empty
// line; "@ignore" followed by text skips only that line.
const IGNORE = /^[\t ]*@ignore(?![\p{L}\p{N}_-])(.*)$/u;

/** Document ranges of lines skipped with @ignore: not read, and not rules. */
export function ignoredLines(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let pos = 0, skipNext = false;
  for (const line of text.split("\n")) {
    const from = pos, to = pos + line.length;
    pos = to + 1;
    const marker = IGNORE.exec(line);
    if (marker) {
      out.push({ from, to });
      skipNext = !marker[1].trim();
    } else if (skipNext && line.trim()) {
      out.push({ from, to });
      skipNext = false;
    }
  }
  return out;
}

/**
 * Markdown blocks that are not prose: fenced code (with its fences), tables,
 * horizontal rules and lines holding only images. Surprisal does not read them.
 */
export function markdownBlocks(text: string): { from: number; to: number }[] {
  const lines: { from: number; to: number; text: string }[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({
      from: pos,
      to: pos + raw.length,
      text: raw.replace(/\r$/, ""),
    });
    pos += raw.length + 1;
  }
  const out: { from: number; to: number }[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence !== null) {
      out.push(line);
      if (
        opener && opener[1][0] === fence[0] &&
        opener[1].length >= fence.length &&
        !line.text.slice(opener[0].length).trim()
      ) fence = null;
      continue;
    }
    if (opener) {
      fence = opener[1];
      out.push(line);
      continue;
    }
    const next = lines[i + 1];
    if (
      line.text.includes("|") && next && next.text.includes("|") &&
      next.text.includes("-") && /^[\s|:-]+$/.test(next.text)
    ) {
      while (lines[i]?.text.includes("|") && lines[i].text.trim()) {
        out.push(lines[i++]);
      }
      i--;
      continue;
    }
    if (
      /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line.text) ||
      /^\s*(!\[[^\]]*\]\([^)]*\)\s*)+$/.test(line.text)
    ) out.push(line);
  }
  return out.map(({ from, to }) => ({ from, to }));
}

/** Markdown inside prose that is not words: inline code, link targets, images, URLs. */
export function markdownInline(text: string): { from: number; to: number }[] {
  return [
    /`[^`\n]+`/g,
    /!\[[^\]\n]*\]\([^)\n]*\)/g,
    /\]\([^)\n]*\)/g,
    /<[a-z][a-z0-9+.-]*:[^>\s]+>/gi,
    /\bhttps?:\/\/[^\s)>\]]+/g,
  ].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m) => ({
      from: m.index,
      to: m.index + m[0].length,
    }))
  );
}

// A rule written on any line: "@rules - Cut adverbs."
const RULE_LINE = /^[\t ]*@rules[\t ]+[-*](?:[\t ]+(.*)|[\t ]*)$/;
// Sections whose lines never hold inline rules.
const NO_INLINE_RULES = ["@rules", "@guide", "@inactive-rules"];

/** Document ranges of "@rules - …" lines outside rule sections. */
export function ruleLines(text: string): { from: number; to: number }[] {
  return sections(text).flatMap((section) => {
    if (NO_INLINE_RULES.includes(section.tag)) return [];
    const out: { from: number; to: number }[] = [];
    let pos = section.start;
    for (const raw of section.text.split("\n")) {
      const from = pos;
      pos += raw.length + 1;
      if (RULE_LINE.test(raw.replace(/\r$/, ""))) {
        out.push({ from, to: from + raw.length });
      }
    }
    return out;
  });
}

export function rulesFromText(
  text: string,
): { rules: Rule[]; errors: string[] } {
  const instructions: string[] = [], errors: string[] = [];
  const skipped = new Set(ignoredLines(text).map((r) => r.from));
  for (const section of sections(text)) {
    if (["@guide", "@inactive-rules"].includes(section.tag)) continue;
    const inSection = section.tag === "@rules";
    let bullet: string | null = null, header = inSection, dropping = false;
    const flush = () => {
      if (bullet !== null) {
        const value = bullet.trim();
        if (!value) errors.push("An empty rule bullet needs text.");
        else if (value.length > 500) {
          errors.push(
            "A rule exceeds 500 characters. Shorten it or split it into bullets.",
          );
        } else instructions.push(value);
      }
      bullet = null;
    };
    let pos = section.start;
    for (const raw of section.text.split("\n")) {
      const from = pos, line = raw.replace(/\r$/, "");
      pos += raw.length + 1;
      if (header) {
        if (line.trim()) header = false;
        continue;
      }
      // An ignored rule is dropped together with its continuation lines.
      if (skipped.has(from)) {
        flush();
        dropping = true;
        continue;
      }
      const m = line.match(RULE_LINE) ??
        (inSection ? line.match(/^\s*[-*](?:\s+(.*)|\s*)$/) : null);
      if (m) {
        flush();
        dropping = false;
        bullet = m[1] || "";
        if (!inSection) flush();
      } else if (inSection && line.trim() && !dropping) {
        if (bullet === null) {
          errors.push("Start each rule with - or * followed by a space.");
        } else bullet += " " + line.trim();
      }
    }
    flush();
  }
  const rules = [...new Set(instructions)].map((instruction, i): Rule => ({
    id: "stream-" + i,
    instruction,
  }));
  return { rules: errors.length ? [] : rules, errors: [...new Set(errors)] };
}
export function leapMatches(
  text: string,
  query: string,
): { from: number; to: number }[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"),
    pattern = new RegExp(escaped, query === query.toLowerCase() ? "giu" : "gu");
  return [...text.matchAll(pattern)].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
  }));
}
