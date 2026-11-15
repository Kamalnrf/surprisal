// Typing helpers for Markdown: shortcuts, input rules and smart punctuation.
// Everything still writes plain GFM, so the saved text stays portable.
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

type Spec = TransactionSpec;

/** Wraps each selection in `mark`, or unwraps it when already wrapped. */
export function wrap(state: EditorState, mark: string): Spec {
  return state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    if (!range.empty && before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - mark.length, to: range.from },
          { from: range.to, to: range.to + mark.length },
        ],
        range: EditorSelection.range(
          range.from - mark.length,
          range.to - mark.length,
        ),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(
        range.from + mark.length,
        range.to + mark.length,
      ),
    };
  });
}

/**
 * [selection](|) with the cursor in the parentheses, [|]() when empty, or
 * [selection](url)| when a URL is given.
 */
export function link(state: EditorState, url = ""): Spec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}](${url})`;
    const cursor = range.empty
      ? range.from + 1
      : range.from + text.length + 3 + url.length + (url ? 1 : 0);
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(cursor),
    };
  });
}

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]/;

/** Indents (or outdents) every selected list item by two spaces. */
export function indentList(state: EditorState, outdent: boolean): Spec | null {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (
      let n = state.doc.lineAt(range.from).number;
      n <= state.doc.lineAt(range.to).number;
      n++
    ) lines.add(n);
  }
  const items = [...lines].map((n) => state.doc.line(n));
  if (!items.length || !items.every((l) => LIST_ITEM.test(l.text))) return null;
  const changes = items.flatMap((line): ChangeSpec[] => {
    if (!outdent) return [{ from: line.from, insert: "  " }];
    const spaces = /^ {0,2}/.exec(line.text)![0].length;
    return spaces ? [{ from: line.from, to: line.from + spaces }] : [];
  });
  return changes.length ? { changes } : null;
}

const CODE = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "CodeText",
  "URL",
]);
function inCode(state: EditorState, pos: number) {
  for (
    let node: { name: string; parent: unknown } | null = syntaxTree(state)
      .resolveInner(pos, -1);
    node;
    node = node.parent as typeof node
  ) if (CODE.has(node.name)) return true;
  return false;
}

/**
 * What typing `text` at a cursor should become, if anything:
 * `[] ` starts a task, and smart punctuation (when on) curls quotes,
 * turns -- into an em dash and ... into an ellipsis.
 */
export function inputRule(
  state: EditorState,
  pos: number,
  text: string,
  smart: boolean,
): { from: number; insert: string; original: string } | null {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  if (text === " ") {
    const task = /^(\s*)\[ ?\]$/.exec(before);
    if (task) {
      return {
        from: line.from,
        insert: `${task[1]}- [ ] `,
        original: before + " ",
      };
    }
  }
  // An odd number of backticks before the cursor is inline code still
  // being typed, before its closing backtick exists.
  if (
    !smart || inCode(state, pos) || (before.match(/`/g)?.length ?? 0) % 2
  ) return null;
  const prev = before.at(-1) ?? "";
  const opening = !prev || /[\s([{\u2014\u2013-]/.test(prev);
  if (text === '"') {
    return { from: pos, insert: opening ? "\u201c" : "\u201d", original: text };
  }
  if (text === "'") {
    return { from: pos, insert: opening ? "\u2018" : "\u2019", original: text };
  }
  // Not at the start of a line (lists, --- dividers) or in table rules.
  if (
    text === "-" && prev === "-" && /[^\s|:-]/.test(before.slice(0, -1)) &&
    !/[|:-]/.test(before.at(-2) ?? "")
  ) return { from: pos - 1, insert: "\u2014", original: "--" };
  if (text === "." && before.endsWith("..")) {
    return { from: pos - 2, insert: "\u2026", original: "..." };
  }
  return null;
}

// The last automatic change, so Backspace right after it restores what was typed.
interface Smart {
  from: number;
  insert: string;
  original: string;
}
const setSmart = StateEffect.define<Smart | null>();
const lastSmart = StateField.define<Smart | null>({
  create: () => null,
  update: (value, tr: Transaction) => {
    for (const e of tr.effects) if (e.is(setSmart)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

const WRAP = { "*": "*", _: "_", "`": "`", "~": "~~" } as Record<
  string,
  string
>;

/** Extensions; `smart` reads the smart punctuation setting at typing time. */
export function typing(smart: () => boolean) {
  return [
    lastSmart,
    EditorView.inputHandler.of((view, from, to, text) => {
      if (view.composing || view.state.readOnly) return false;
      const { state } = view;
      // Typing a marker over a selection wraps it.
      if (WRAP[text] && !state.selection.main.empty) {
        view.dispatch({ ...wrap(state, WRAP[text]), userEvent: "input.wrap" });
        return true;
      }
      if (from !== to || state.selection.ranges.length > 1) return false;
      const rule = inputRule(state, from, text, smart());
      if (!rule) return false;
      view.dispatch({
        changes: { from: rule.from, to, insert: rule.insert },
        selection: { anchor: rule.from + rule.insert.length },
        effects: setSmart.of(rule),
        userEvent: "input.type",
      });
      return true;
    }),
    keymap.of([
      {
        key: "Backspace",
        run(view) {
          const last = view.state.field(lastSmart);
          const head = view.state.selection.main;
          const end = last ? last.from + last.insert.length : -1;
          if (
            !last || !head.empty || head.head !== end ||
            view.state.sliceDoc(last.from, end) !== last.insert
          ) return false;
          view.dispatch({
            changes: { from: last.from, to: end, insert: last.original },
            selection: { anchor: last.from + last.original.length },
            userEvent: "delete.backward",
          });
          return true;
        },
      },
      {
        key: "Mod-b",
        run: (
          v,
        ) => (v.dispatch({ ...wrap(v.state, "**"), userEvent: "input" }), true),
      },
      {
        key: "Mod-i",
        run: (
          v,
        ) => (v.dispatch({ ...wrap(v.state, "*"), userEvent: "input" }), true),
      },
      {
        key: "Mod-k",
        run: (
          v,
        ) => (v.dispatch({ ...link(v.state), userEvent: "input" }), true),
      },
      {
        key: "Tab",
        run: (v) => {
          const spec = indentList(v.state, false);
          if (spec) v.dispatch({ ...spec, userEvent: "input.indent" });
          return !!spec;
        },
      },
      {
        key: "Shift-Tab",
        run: (v) => {
          const spec = indentList(v.state, true);
          if (spec) v.dispatch({ ...spec, userEvent: "delete.dedent" });
          return !!spec;
        },
      },
    ]),
    EditorView.domEventHandlers({
      // Pasting a URL over a selection makes it a link.
      paste(event, view) {
        const url = event.clipboardData?.getData("text/plain").trim() ?? "";
        if (view.state.selection.main.empty || !/^https?:\/\/\S+$/.test(url)) {
          return false;
        }
        event.preventDefault();
        view.dispatch({ ...link(view.state, url), userEvent: "input.paste" });
        return true;
      },
      // ⌘- or Ctrl-click opens a link.
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        for (
          const m of line.text.matchAll(
            /\[[^\]\n]*\]\((\S+?)\)|<(https?:[^>\s]+)>|(https?:\/\/[^\s)>\]]+)/g,
          )
        ) {
          const start = line.from + m.index, end = start + m[0].length;
          if (pos < start || pos > end) continue;
          const url = m[1] ?? m[2] ?? m[3];
          if (!/^https?:/i.test(url)) return false;
          event.preventDefault();
          globalThis.open(url, "_blank", "noopener");
          return true;
        }
        return false;
      },
    }),
  ];
}
