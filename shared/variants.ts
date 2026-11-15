import { sentences, streamFocus } from "./stream.ts";

export type Part = { text: string } | { groupId: string };
export type VariantKind = "word" | "sentence" | "paragraph" | "passage";
export interface VariantGroup {
  id: string;
  kind: VariantKind;
  optionIds: string[];
  activeOptionId: string;
}
export interface VariantOption {
  id: string;
  parts: Part[];
}
export interface WritingDocument {
  schemaVersion: 2;
  root: Part[];
  groups: Record<string, VariantGroup>;
  options: Record<string, VariantOption>;
}
export interface VisibleGroup {
  groupId: string;
  from: number;
  to: number;
  ancestors: string[];
}

// Classify against surrounding writing so fragments are not mistaken for whole sentences.
export function inferVariantKind(
  text: string,
  from: number,
  to: number,
): VariantKind {
  const selected = text.slice(from, to);
  const trimmed = selected.trim();
  if (!trimmed) return "passage";
  const start = from + selected.length - selected.trimStart().length;
  const end = start + trimmed.length;
  const paragraph = streamFocus(text, start);
  if (end > paragraph.end) return "passage";
  const localStart = start - paragraph.start;
  const localEnd = end - paragraph.start;
  const words = new Intl.Segmenter("en", { granularity: "word" });
  for (const word of words.segment(paragraph.text)) {
    if (
      word.isWordLike && word.index === localStart &&
      word.index + word.segment.length === localEnd
    ) return "word";
  }
  if (
    sentences(paragraph.text).some((sentence) =>
      sentence.start === localStart && sentence.end === localEnd
    )
  ) return "sentence";
  if (trimmed === paragraph.text.trim()) return "paragraph";
  return "passage";
}

const kinds: VariantKind[] = ["word", "sentence", "paragraph", "passage"];
const own = (table: object, id: string) => Object.hasOwn(table, id);
const id = () => crypto.randomUUID();
// Copy tables, then only replace records on the edited path. History shares inactive branches.
function copy(doc: WritingDocument): WritingDocument {
  return { ...doc, groups: { ...doc.groups }, options: { ...doc.options } };
}
function copyGroup(doc: WritingDocument, groupId: string): VariantGroup {
  const original = group(doc, groupId);
  return doc.groups[groupId] = {
    ...original,
    optionIds: [...original.optionIds],
  };
}
function group(doc: WritingDocument, groupId: string): VariantGroup {
  if (!own(doc.groups, groupId)) throw new Error("Unknown group");
  return doc.groups[groupId];
}
function active(doc: WritingDocument, groupId: string): VariantOption {
  return doc.options[group(doc, groupId).activeOptionId];
}
function renderParts(doc: WritingDocument, parts: Part[]): string {
  return parts.map((p) =>
    "text" in p ? p.text : renderParts(doc, active(doc, p.groupId).parts)
  ).join("");
}
export function documentFromText(text: string): WritingDocument {
  return {
    schemaVersion: 2,
    root: text ? [{ text }] : [],
    groups: {},
    options: {},
  };
}
export function renderDocument(doc: WritingDocument): string {
  return renderParts(doc, doc.root);
}
export function visibleGroups(doc: WritingDocument): VisibleGroup[] {
  const result: VisibleGroup[] = [];
  function visit(parts: Part[], from: number, ancestors: string[]): number {
    for (const part of parts) {
      if ("text" in part) from += part.text.length;
      else {
        const range = { groupId: part.groupId, from, to: from, ancestors };
        result.push(range);
        from = visit(active(doc, part.groupId).parts, from, [
          ...ancestors,
          part.groupId,
        ]);
        range.to = from;
      }
    }
    return from;
  }
  visit(doc.root, 0, []);
  return result;
}
function normalize(parts: Part[]): Part[] {
  const result: Part[] = [];
  for (const part of parts) {
    if ("text" in part) {
      if (!part.text) continue;
      const last = result.at(-1);
      if (last && "text" in last) last.text += part.text;
      else result.push({ text: part.text });
    } else result.push({ groupId: part.groupId });
  }
  return result.length === parts.length &&
      result.every((part, index) => {
        const previous = parts[index];
        return "text" in part
          ? "text" in previous && part.text === previous.text
          : "groupId" in previous && part.groupId === previous.groupId;
      })
    ? parts
    : result;
}
// Reachability includes every inactive branch, not just the text projection.
function finish(doc: WritingDocument): WritingDocument {
  const groups = new Set<string>();
  const options = new Set<string>();
  function visit(parts: Part[]): Part[] {
    for (const part of parts) {
      if ("text" in part) continue;
      groups.add(part.groupId);
      for (const optionId of doc.groups[part.groupId].optionIds) {
        options.add(optionId);
        const option = doc.options[optionId];
        const parts = visit(option.parts);
        if (parts !== option.parts) {
          doc.options[optionId] = { ...option, parts };
        }
      }
    }
    return normalize(parts);
  }
  doc.root = visit(doc.root);
  for (const key of Object.keys(doc.groups)) {
    if (!groups.has(key)) delete doc.groups[key];
  }
  for (const key of Object.keys(doc.options)) {
    if (!options.has(key)) delete doc.options[key];
  }
  return doc;
}
export function validateDocument(value: unknown): WritingDocument {
  const fail = (): never => {
    throw new Error("Invalid variants document");
  };
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (
    !record(value) || value.schemaVersion !== 2 || !record(value.groups) ||
    !record(value.options)
  ) fail();
  const doc = value as unknown as WritingDocument;
  const groups = new Set<string>();
  const options = new Set<string>();
  function visit(parts: unknown): void {
    if (!Array.isArray(parts)) fail();
    for (const p of parts as unknown[]) {
      if (!record(p)) fail();
      const part = p as Record<string, unknown>;
      if (own(part, "text")) {
        if (typeof part.text !== "string" || own(part, "groupId")) fail();
        continue;
      }
      const key = part.groupId;
      if (typeof key !== "string" || !own(doc.groups, key) || groups.has(key)) {
        fail();
      }
      const groupId = key as string;
      groups.add(groupId);
      const g = doc.groups[groupId];
      if (
        !record(g) || g.id !== groupId || !kinds.includes(g.kind) ||
        !Array.isArray(g.optionIds) || !g.optionIds.length ||
        typeof g.activeOptionId !== "string" ||
        !g.optionIds.includes(g.activeOptionId)
      ) fail();
      for (const optionId of g.optionIds) {
        if (
          typeof optionId !== "string" || options.has(optionId) ||
          !own(doc.options, optionId)
        ) fail();
        options.add(optionId);
        const o = doc.options[optionId];
        if (!record(o) || o.id !== optionId) fail();
        visit(o.parts);
      }
    }
  }
  visit(doc.root);
  if (
    groups.size !== Object.keys(doc.groups).length ||
    options.size !== Object.keys(doc.options).length
  ) fail();
  return finish(structuredClone(doc));
}
function bounds(from: number, to: number, length: number): void {
  if (
    !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from ||
    to > length
  ) throw new Error("Invalid range");
}
function length(doc: WritingDocument, p: Part): number {
  return "text" in p
    ? p.text.length
    : renderParts(doc, active(doc, p.groupId).parts).length;
}
// Split only at text boundaries or between whole references.
function split(
  doc: WritingDocument,
  parts: Part[],
  offset: number,
): [Part[], Part[]] {
  const before: Part[] = [];
  const after: Part[] = [];
  let position = 0;
  for (const p of parts) {
    const end = position + length(doc, p);
    if (position >= offset) after.push(p);
    else if (end <= offset) before.push(p);
    else if ("text" in p) {
      before.push({ text: p.text.slice(0, offset - position) });
      after.push({ text: p.text.slice(offset - position) });
    } else throw new Error("Crossing group boundary");
    position = end;
  }
  return [before, after];
}
function splice(
  doc: WritingDocument,
  parts: Part[],
  from: number,
  to: number,
  text: string,
): Part[] {
  let position = 0;
  for (const p of parts) {
    const end = position + length(doc, p);
    if ("groupId" in p) {
      const contained = from >= position && to <= end;
      const interior = from === to
        ? from > position && from < end
        : contained && (from !== position || to !== end);
      if (interior) {
        const option = active(doc, p.groupId);
        doc.options[option.id] = {
          ...option,
          parts: splice(
            doc,
            option.parts,
            from - position,
            to - position,
            text,
          ),
        };
        return parts;
      }
    }
    position = end;
  }
  position = 0;
  let expanded = false;
  const flattened: Part[] = [];
  for (const p of parts) {
    const end = position + length(doc, p);
    const overlaps = from < end && to > position ||
      (position === end && from <= position && position < to);
    if ("groupId" in p && overlaps) {
      flattened.push(...active(doc, p.groupId).parts);
      expanded = true;
    } else flattened.push(p);
    position = end;
  }
  if (expanded) return splice(doc, flattened, from, to, text);
  const [before, rest] = split(doc, parts, from);
  const [, after] = split(doc, rest, to - from);
  return normalize([...before, { text }, ...after]);
}
export function createGroup(
  doc: WritingDocument,
  from: number,
  to: number,
  kind: VariantKind,
): { document: WritingDocument; groupId: string } {
  bounds(from, to, renderDocument(doc).length);
  if (from === to || !kinds.includes(kind)) {
    throw new Error("Invalid group selection");
  }
  const next = copy(doc);
  const groupId = id();
  const optionId = id();
  function wrap(parts: Part[], start: number, end: number): Part[] {
    let position = 0;
    for (const p of parts) {
      const limit = position + length(next, p);
      if ("groupId" in p) {
        if (start === position && end === limit) {
          throw new Error("Group already exists");
        }
        if (start >= position && end <= limit) {
          const option = active(next, p.groupId);
          next.options[option.id] = {
            ...option,
            parts: wrap(option.parts, start - position, end - position),
          };
          return parts;
        }
        if (
          start < limit && end > position &&
          !(start <= position && end >= limit)
        ) throw new Error("Crossing groups");
      }
      position = limit;
    }
    const [before, rest] = split(next, parts, start);
    const [selected, after] = split(next, rest, end - start);
    next.groups[groupId] = {
      id: groupId,
      kind,
      optionIds: [optionId],
      activeOptionId: optionId,
    };
    next.options[optionId] = { id: optionId, parts: selected };
    return [...before, { groupId }, ...after];
  }
  next.root = wrap(next.root, from, to);
  return { document: finish(next), groupId };
}
export function addOption(
  doc: WritingDocument,
  groupId: string,
  text?: string,
): { document: WritingDocument; optionId: string } {
  const next = copy(doc);
  const g = copyGroup(next, groupId);
  function cloneOption(sourceId: string): string {
    const optionId = id();
    const parts = next.options[sourceId].parts.map((p): Part => {
      if ("text" in p) return { text: p.text };
      const source = group(next, p.groupId);
      const newId = id();
      const optionIds = source.optionIds.map(cloneOption);
      next.groups[newId] = {
        ...source,
        id: newId,
        optionIds,
        activeOptionId:
          optionIds[source.optionIds.indexOf(source.activeOptionId)],
      };
      return { groupId: newId };
    });
    next.options[optionId] = { id: optionId, parts };
    return optionId;
  }
  const optionId = text === undefined ? cloneOption(g.activeOptionId) : id();
  if (text !== undefined) {
    next.options[optionId] = { id: optionId, parts: text ? [{ text }] : [] };
  }
  g.optionIds.push(optionId);
  g.activeOptionId = optionId;
  return { document: finish(next), optionId };
}
export function activateOption(
  doc: WritingDocument,
  groupId: string,
  optionId: string,
): WritingDocument {
  const next = copy(doc);
  const g = copyGroup(next, groupId);
  if (!g.optionIds.includes(optionId)) {
    throw new Error("Option does not belong to group");
  }
  g.activeOptionId = optionId;
  return finish(next);
}
export function editOption(
  doc: WritingDocument,
  groupId: string,
  from: number,
  to: number,
  text: string,
): WritingDocument {
  const next = copy(doc);
  const option = active(next, groupId);
  bounds(from, to, renderParts(next, option.parts).length);
  next.options[option.id] = {
    ...option,
    parts: splice(next, option.parts, from, to, text),
  };
  return finish(next);
}
export function removeOption(
  doc: WritingDocument,
  groupId: string,
  optionId: string,
): WritingDocument {
  const next = copy(doc);
  const g = copyGroup(next, groupId);
  const index = g.optionIds.indexOf(optionId);
  if (index < 0 || g.optionIds.length === 1) {
    throw new Error("Cannot remove option");
  }
  g.optionIds.splice(index, 1);
  if (g.activeOptionId === optionId) {
    g.activeOptionId = g.optionIds[Math.min(index, g.optionIds.length - 1)];
  }
  return finish(next);
}
export function unwrapGroup(
  doc: WritingDocument,
  groupId: string,
): WritingDocument {
  const next = copy(doc);
  const replacement = active(next, groupId).parts;
  const unwrap = (parts: Part[]): Part[] =>
    parts.flatMap((p) =>
      "groupId" in p && p.groupId === groupId ? replacement : [p]
    );
  next.root = unwrap(next.root);
  for (const option of Object.values(next.options)) {
    const parts = unwrap(option.parts);
    if (
      parts.some((part, index) => part !== option.parts[index]) ||
      parts.length !== option.parts.length
    ) next.options[option.id] = { ...option, parts };
  }
  return finish(next);
}
/** Offsets are UTF-16 code units against the original projection. Edits must not overlap. */
export function applyTextEdits(
  doc: WritingDocument,
  edits: { from: number; to: number; text: string }[],
): WritingDocument {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  let limit = renderDocument(doc).length;
  for (const edit of sorted) {
    bounds(edit.from, edit.to, limit);
    limit = edit.from;
  }
  const next = copy(doc);
  for (const edit of sorted) {
    next.root = splice(next, next.root, edit.from, edit.to, edit.text);
  }
  return finish(next);
}
