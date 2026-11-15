import type { EditorSelection } from "@codemirror/state";
import type { WritingDocument } from "../../../shared/variants.ts";
import type { Heat } from "../../../shared/surprisal.ts";

export interface Leap {
  origin: EditorSelection;
  scroll: number;
  direction: 1 | -1;
  query: string;
  matches: { from: number; to: number }[];
  index: number;
}

export interface EditorSnapshot {
  text: string;
  document: WritingDocument;
  head: number;
  from: number;
  to: number;
  composing: boolean;
  leaping: boolean;
}

export interface EditorHandle {
  createVariant: (from: number, to: number, text: string) => string;
  addVariant: (groupId: string, text: string) => void;
  activateVariant: (groupId: string, optionId: string) => void;
  editVariant: (groupId: string, text: string) => void;
  removeVariant: (groupId: string, optionId: string) => void;
  unwrapVariant: (groupId: string) => void;
  undo: () => void;
  redo: () => void;
  insert: (from: number, to: number, text: string) => void;
  insertBreak: () => void;
  openLeap: (direction?: 1 | -1) => void;
  closeLeap: (position?: number) => void;
  search: (query: string) => void;
  focus: (position: number) => void;
  measure: () => void;
  // Replaces the autopilot marks; positions are in the current document.
  setHeat: (heat: Heat[]) => void;
  // Selects a range, which opens its variants.
  select: (from: number, to: number) => void;
  // Scrolls the selection to the top, above the mobile drawer.
  reveal: () => void;
}
