// GitHub-flavoured Markdown, iA Writer style: the syntax stays in the text,
// dimmed, and styles the writing around it. Nothing is hidden, so every
// position (marks, variants, rules) is the same as in plain text.
import {
  type EditorState,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  markdown,
  markdownLanguage,
} from "@codemirror/lang-markdown";

const style = HighlightStyle.define([
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.emphasis, class: "md-em" },
  { tag: tags.strikethrough, class: "md-strike" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-url" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  {
    tag: [tags.processingInstruction, tags.contentSeparator],
    class: "md-mark",
  },
  { tag: tags.labelName, class: "md-mark" },
]);

const LIST = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+)(\[[ xX]\][ \t]+)?/;
const IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g;

class Image extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  override eq(other: Image) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "md-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    img.onload = () => view.requestMeasure();
    img.onerror = () => {
      box.hidden = true;
      view.requestMeasure();
    };
    box.append(img);
    return box;
  }
  override ignoreEvent() {
    return false;
  }
}

function decorate(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let fence: string | null = null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n), text = line.text;
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence !== null || opener) {
      ranges.push(Decoration.line({ class: "md-codeblock" }).range(line.from));
      if (fence === null) fence = opener![1];
      else if (
        opener && opener[1][0] === fence[0] && opener[1].length >= fence.length
      ) fence = null;
      continue;
    }
    const heading = /^(#{1,6})[ \t]/.exec(text);
    if (heading) {
      ranges.push(
        Decoration.line({
          class: "md-h",
          attributes: { style: `--mark:${heading[1].length + 1}ch` },
        }).range(line.from),
      );
      continue;
    }
    const quote = /^(\s*>\s?)+/.exec(text);
    const list = LIST.exec(quote ? text.slice(quote[0].length) : text);
    // Wrapped lines of quotes and list items hang under their text.
    const hang = (quote?.[0].length ?? 0) +
      (list ? list[1].length + (list[2]?.length ?? 0) : 0);
    if (hang) {
      ranges.push(
        Decoration.line({
          class: quote ? "md-quote-line" : "md-list",
          attributes: { style: `--hang:${hang}ch` },
        }).range(line.from),
      );
    }
    if (list?.[2]) {
      const at = line.from + (quote?.[0].length ?? 0) + list[1].length;
      const done = list[2][1] !== " ";
      ranges.push(
        Decoration.mark({
          class: `md-task${done ? " md-task-done" : ""}`,
          attributes: { title: done ? "Done: tap to reopen" : "Tap to tick" },
        }).range(at, at + 3),
      );
      if (done && at + list[2].length < line.to) {
        ranges.push(
          Decoration.mark({ class: "md-done" }).range(
            at + list[2].length,
            line.to,
          ),
        );
      }
    }
    for (const image of text.matchAll(IMAGE)) {
      if (/^(https?:|data:image\/)/i.test(image[2])) {
        ranges.push(
          Decoration.widget({
            widget: new Image(image[2], image[1]),
            block: true,
            side: 1,
          }).range(line.to),
        );
      }
    }
  }
  return Decoration.set(ranges, true);
}

const lines = StateField.define<DecorationSet>({
  create: decorate,
  update: (value, tr) => tr.docChanged ? decorate(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

// Tapping a task's box ticks it and leaves the cursor just after the box,
// so the view stays where the tap was.
const tasks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const box = (event.target as HTMLElement).closest(".md-task");
    if (!box || event.button !== 0) return false;
    const pos = view.posAtDOM(box, 0);
    const mark = view.state.sliceDoc(pos + 1, pos + 2);
    event.preventDefault();
    view.focus();
    view.dispatch({
      changes: { from: pos + 1, to: pos + 2, insert: mark === " " ? "x" : " " },
      selection: { anchor: pos + 3 },
      userEvent: "input.task",
    });
    return true;
  },
});

export const markdownEditing = [
  markdown({ base: markdownLanguage, completeHTMLTags: false }),
  syntaxHighlighting(style),
  lines,
  tasks,
];
