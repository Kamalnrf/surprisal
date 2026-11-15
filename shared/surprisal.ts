import {
  ignoredLines,
  markdownBlocks,
  markdownInline,
  paragraphs,
  ruleLines,
  sections,
  sentences,
} from "./stream.ts";
import type { SurprisalToken } from "./types.ts";

// Grammar words are always predictable; marking them says nothing about the
// writer's choices.
const FUNCTION_WORDS = new Set(
  `a an the and or but nor so yet for of in on at to from by with without into
onto over under about above below after before as than then that this these
those there here it its it's is was were be been being am are has have had do
does did not no me my we us our you your he him his she her they them their
what which who whom whose when where why how all any some each every more most
much many very just also too can could will would shall should may might must
if`.split(/\s+/),
);

const overlaps = (
  ranges: { from: number; to: number }[],
  from: number,
  to: number,
) => ranges.some((r) => r.from < to && from < r.to);

/** A word counts as autopilot when it was the model's first guess and a likely one. */
export const AUTOPILOT_P = 0.2;

export interface Heat {
  from: number;
  to: number;
  // Probability the model gave the whole word, 0.2–1; 1 for phrases and sentences.
  p: number;
  // word (the default), a stock phrase, an echo of earlier words, or an autopilot sentence.
  kind?: "word" | "stock" | "echo" | "sentence";
}

export interface WordReading {
  p: number;
  // The model's rank for the word's first token; 1 means it was the first guess.
  rank: number;
  // What the model expected at this spot instead, as words, most likely first.
  guesses: { text: string; p: number }[];
}

/** What the model thought of the text between `from` and `to`. */
export function readWord(
  tokens: SurprisalToken[],
  from: number,
  to: number,
): WordReading | null {
  const parts = tokens.filter((t) => t.end > from && t.start < to);
  if (!parts.length) return null;
  const seen = new Set<string>();
  const guesses = parts[0].guesses.flatMap((g) => {
    const text = g.text.trim();
    if (!/\p{L}/u.test(text) || seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    return [{ text, p: Math.exp(g.logprob) }];
  });
  return {
    p: Math.exp(parts.reduce((sum, t) => sum + t.logprob, 0)),
    rank: parts[0].rank,
    guesses,
  };
}

/**
 * Words the model would have written itself. Positions are in `text`;
 * words that start before `from` (supplied context) are skipped.
 */
export function autopilot(
  text: string,
  tokens: SurprisalToken[],
  from = 0,
): Heat[] {
  const heat: Heat[] = [];
  const code = markdownInline(text);
  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  for (const word of segmenter.segment(text)) {
    const start = word.index, end = start + word.segment.length;
    if (
      start < from || !word.isWordLike || word.segment.length < 3 ||
      overlaps(code, start, end) ||
      !/\p{L}/u.test(word.segment) ||
      FUNCTION_WORDS.has(word.segment.toLowerCase())
    ) continue;
    const reading = readWord(tokens, start, end);
    if (reading?.rank === 1 && reading.p >= AUTOPILOT_P) {
      heat.push({ from: start, to: end, p: reading.p });
    }
  }
  return heat;
}

/** A word in a run counts as expected at this lower bar; runs are what make a phrase stock. */
export const PHRASE_P = 0.3;

export interface Phrase {
  from: number;
  to: number;
  // stock: the model finished it for you. echo: it predicted your own earlier words.
  kind: "stock" | "echo";
}

/**
 * Runs of two or more words the model guessed first, each with at least 30%,
 * plus the word that cued them. Sentence punctuation ends a run; trailing
 * grammar words are trimmed. Positions are in `text`; runs before `from` are skipped.
 */
export function phrases(
  text: string,
  tokens: SurprisalToken[],
  from = 0,
): Phrase[] {
  const code = markdownInline(text);
  const words = [...new Intl.Segmenter("en", { granularity: "word" })
    .segment(text)].filter((w) =>
      w.isWordLike && !overlaps(code, w.index, w.index + w.segment.length)
    );
  const found: Phrase[] = [];
  let run: typeof words = [];
  const flush = (cueIndex: number) => {
    while (
      run.length && FUNCTION_WORDS.has(run.at(-1)!.segment.toLowerCase())
    ) {
      run.pop();
    }
    const cue = words[cueIndex];
    if (
      run.length >= 2 && cue && cue.index >= from &&
      run.some((w) => !FUNCTION_WORDS.has(w.segment.toLowerCase()))
    ) {
      const start = cue.index;
      const end = run.at(-1)!.index + run.at(-1)!.segment.length;
      // An echo repeats words that already appeared earlier in the passage.
      const said = text.slice(run[0].index, end).toLowerCase().replace(
        /\s+/g,
        " ",
      );
      const earlier = text.slice(0, run[0].index).toLowerCase().replace(
        /\s+/g,
        " ",
      );
      found.push({
        from: start,
        to: end,
        kind: earlier.includes(said) ? "echo" : "stock",
      });
    }
    run = [];
  };
  let cueIndex = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const gap = i
      ? text.slice(words[i - 1].index + words[i - 1].segment.length, w.index)
      : "";
    // Punctuation, a line break or skipped markdown ends a run.
    if (run.length && /[.,;:!?()"“”—\n`\[\]]/.test(gap)) flush(cueIndex);
    const reading = readWord(tokens, w.index, w.index + w.segment.length);
    if (reading?.rank === 1 && reading.p >= PHRASE_P) {
      if (!run.length) cueIndex = i - 1;
      // A cue across sentence punctuation is not part of the phrase.
      if (!run.length && cueIndex >= 0 && /[.,;:!?()"“”—\n`\[\]]/.test(gap)) {
        cueIndex = -1;
      }
      run.push(w);
    } else if (run.length) flush(cueIndex);
  }
  if (run.length) flush(cueIndex);
  return found;
}

export interface Temperature {
  from: number;
  to: number;
  text: string;
  // Mean surprise per model word piece, in bits; low means predictable.
  bits: number;
  level: "expected" | "half-expected" | "unexpected";
}

/** Bits as odds: on average the model guessed each word piece at 1 in this. */
export const odds = (bits: number) => Math.round(2 ** bits);

// From the test passages: clichés and LLM house style sit at 2.8–3.6 bits,
// plain specific prose at 5.5–6.4, the writer's own prose at 6.8–8.5.
export const EXPECTED_BITS = 4.5;
export const UNEXPECTED_BITS = 5.5;

/** How predictable each sentence after `from` was, in order. */
export function temperatures(
  text: string,
  tokens: SurprisalToken[],
  from = 0,
): Temperature[] {
  // A line break also ends a sentence: list items, quotes and headings have
  // no full stop. Headings get no label.
  const lines = sentences(text.slice(from)).flatMap((sentence) => {
    let at = from + sentence.start;
    return sentence.text.split("\n").flatMap((piece) => {
      const start = at + piece.length - piece.trimStart().length;
      at += piece.length + 1;
      const quote = piece.trim();
      return quote && !/^#{1,6}\s/.test(quote)
        ? [{ start, end: start + quote.length, text: quote }]
        : [];
    });
  });
  return lines.flatMap((sentence) => {
    const start = sentence.start, end = sentence.end;
    const parts = tokens.filter((t) => t.start >= start && t.end <= end);
    if (parts.length < 4) return [];
    const bits = parts.reduce((sum, t) => sum - t.logprob, 0) / parts.length /
      Math.LN2;
    return [{
      from: start,
      to: end,
      text: sentence.text,
      bits,
      level: bits < EXPECTED_BITS
        ? "expected"
        : bits < UNEXPECTED_BITS
        ? "half-expected"
        : "unexpected",
    }];
  });
}

export interface Passage {
  // What is sent to the model: the previous paragraph, then this one.
  text: string;
  // Length of the leading context; marks start after it.
  context: number;
  // Document position of text[0].
  offset: number;
  // Document range of the paragraph itself.
  start: number;
  end: number;
}

const UNREAD = ["@rules", "@guide", "@inactive-rules"];

/** The parts of [from, to) outside ignored lines, trimmed of surrounding whitespace. */
function readableParts(
  text: string,
  from: number,
  to: number,
  skip: { from: number; to: number }[],
) {
  const cuts: [number, number][] = [];
  let cursor = from;
  for (const s of skip) {
    if (s.to < from || s.from > to) continue;
    if (s.from > cursor) cuts.push([cursor, s.from]);
    cursor = Math.max(cursor, s.to);
  }
  cuts.push([cursor, to]);
  return cuts.flatMap(([a, b]) => {
    const raw = text.slice(a, b);
    const start = a + raw.length - raw.trimStart().length;
    const end = a + raw.trimEnd().length;
    return end > start ? [{ start, end, text: text.slice(start, end) }] : [];
  });
}

/**
 * Every paragraph Surprisal reads, each with the readable text before it as
 * context. Ignored lines split a paragraph into separately read parts.
 */
export function passages(text: string): Passage[] {
  const out: Passage[] = [];
  const skip = [
    ...ignoredLines(text),
    ...ruleLines(text),
    ...markdownBlocks(text),
  ].sort((a, b) => a.from - b.from);
  for (const section of sections(text)) {
    if (UNREAD.includes(section.tag)) continue;
    let previous = "";
    for (const part of paragraphs(section.text)) {
      for (
        const chunk of readableParts(
          text,
          section.start + part.start,
          section.start + part.end,
          skip,
        )
      ) {
        const before = previous ? previous.slice(-1200) + "\n\n" : "";
        previous = chunk.text;
        const passage = before + chunk.text;
        if (passage.length > 4000) continue;
        out.push({
          text: passage,
          context: before.length,
          offset: chunk.start - before.length,
          start: chunk.start,
          end: chunk.end,
        });
      }
    }
  }
  return out;
}
