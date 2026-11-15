import {
  Annotation,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import {
  invertedEffects,
  isolateHistory,
} from "@codemirror/commands";
import {
  applyTextEdits,
  documentFromText,
  renderDocument,
  type WritingDocument,
} from "../../../shared/variants.ts";
import {
  Decoration,
  EditorView,
  layer,
  RectangleMarker,
  WidgetType,
} from "@codemirror/view";
import { visibleGroups } from "../../../shared/variants.ts";
import { streamFocus } from "../../../shared/stream.ts";

export const restoreDocument = StateEffect.define<WritingDocument>();
export const sidebarEdit = Annotation.define<boolean>();
export const setVariantDisplay = StateEffect.define<
  { enabled: boolean; groupId: string | null }
>();
export const variantDisplay = StateField.define({
  create: () => ({ enabled: true, groupId: null as string | null }),
  update: (value, transaction) =>
    transaction.effects.find((effect) => effect.is(setVariantDisplay))?.value ??
      value,
});

export const documentField = StateField.define<WritingDocument>({
  create: (state) => documentFromText(state.doc.toString()),
  update(document, transaction) {
    // Undo restores the graph paired with its inverse text change, not a second edit.
    const restored = transaction.effects.filter((effect) =>
      effect.is(restoreDocument)
    ).at(-1);
    if (restored) return restored.value;
    if (!transaction.docChanged) return document;
    const edits: { from: number; to: number; text: string }[] = [];
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      edits.push({ from, to, text: inserted.toString() });
    });
    return applyTextEdits(document, edits);
  },
});

export const documentHistory = invertedEffects.of((transaction) => {
  const before = transaction.startState.field(documentField);
  return before === transaction.state.field(documentField)
    ? []
    : [restoreDocument.of(before)];
});

/** A local splice keeps child anchors, caret mapping and IME updates intact. */
export function textChange(before: string, after: string) {
  let from = 0;
  while (
    from < before.length && from < after.length && before[from] === after[from]
  ) from++;
  let to = before.length;
  let end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) {
    to--;
    end--;
  }
  return { from, to, text: after.slice(from, end) };
}

export function documentTransaction(
  state: EditorState,
  document: WritingDocument,
  isolated = true,
): TransactionSpec {
  const change = textChange(state.doc.toString(), renderDocument(document));
  return {
    changes: { from: change.from, to: change.to, insert: change.text },
    effects: restoreDocument.of(document),
    annotations: [
      sidebarEdit.of(true),
      ...(isolated ? [isolateHistory.of("full")] : []),
    ],
    userEvent: isolated ? "input.variant" : "input.type",
  };
}

class EmptyVariant extends WidgetType {
  constructor(
    readonly groupId: string,
    readonly count: number,
  ) {
    super();
  }
  override eq(other: EmptyVariant) {
    return other.groupId === this.groupId && other.count === this.count;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.className = "variant-empty";
    button.type = "button";
    button.dataset.variant = this.groupId;
    button.textContent = "·".repeat(this.count);
    button.setAttribute(
      "aria-label",
      `Edit ${this.count} versions of omitted passage`,
    );
    button.title =
      `${this.count} saved versions, including the current version`;
    button.addEventListener(
      "click",
      () =>
        view.dom.dispatchEvent(
          new CustomEvent("open-variant", {
            detail: this.groupId,
            bubbles: true,
          }),
        ),
    );
    return button;
  }
}

const setMultilineVariants = StateEffect.define<ReadonlySet<string>>();
const multilineVariants = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update: (value, transaction) =>
    transaction.effects.find((effect) => effect.is(setMultilineVariants))
      ?.value ??
      value,
});

const variantMarks = EditorView.decorations.compute([
  documentField,
  variantDisplay,
  multilineVariants,
], (state) => {
  const display = state.field(variantDisplay);
  if (!display.enabled) return Decoration.none;
  const doc = state.field(documentField);
  const groups = visibleGroups(doc);
  const ranges = groups.flatMap((range) => {
    const group = doc.groups[range.groupId];
    if (range.from === range.to) {
      return [
        Decoration.widget({
          widget: new EmptyVariant(range.groupId, group.optionIds.length),
          side: 1,
        })
          .range(range.from),
      ];
    }
    if (group.optionIds.length < 2 && range.groupId !== display.groupId) {
      return [];
    }
    return [
      Decoration.mark({
        class: `variant-mark ${
          range.groupId === display.groupId ? "variant-selected" : ""
        } ${
          state.field(multilineVariants).has(range.groupId)
            ? "variant-multiline"
            : ""
        }`,
        attributes: {
          "data-variant": range.groupId,
          title: `${group.kind} · ${group.optionIds.length} choices`,
        },
      }).range(range.from, range.to),
    ];
  });
  const selected = groups.find((range) => range.groupId === display.groupId);
  if (selected) {
    const paragraph = streamFocus(state.doc.toString(), selected.from);
    const from = Math.min(paragraph.start, selected.from);
    const to = Math.max(paragraph.end, selected.to);
    if (from > 0) {
      ranges.push(Decoration.mark({ class: "variant-context" }).range(0, from));
    }
    if (to < state.doc.length) {
      ranges.push(
        Decoration.mark({ class: "variant-context" }).range(
          to,
          state.doc.length,
        ),
      );
    }
  }
  return Decoration.set(ranges, true);
});

export const variantDecorations = [
  multilineVariants,
  variantMarks,
  layer({
    above: true,
    update: (update) =>
      update.viewportChanged ||
      update.startState.field(documentField) !==
        update.state.field(documentField) ||
      update.startState.field(variantDisplay) !==
        update.state.field(variantDisplay),
    markers(view) {
      const state = view.state;
      const display = state.field(variantDisplay);
      if (!display.enabled) return [];
      const doc = state.field(documentField);
      const previous = state.field(multilineVariants);
      const multiline = new Set<string>();
      const markers: RectangleMarker[] = [];
      const line = view.contentDOM.querySelector(".cm-line");
      if (!line) return markers;
      // Use CodeMirror's coordinate origin, including scrolling and text direction.
      const origin = RectangleMarker.forRange(
        view,
        "",
        EditorSelection.cursor(view.viewport.from),
      )[0];
      const point = view.coordsAtPos(view.viewport.from, 1);
      if (!origin || !point) return markers;
      const content = view.contentDOM.getBoundingClientRect();
      const left = content.left +
        parseFloat(getComputedStyle(line).paddingLeft) - point.left +
        origin.left;
      for (const range of visibleGroups(doc)) {
        if (
          range.from === range.to ||
          (doc.groups[range.groupId].optionIds.length < 2 &&
            range.groupId !== display.groupId)
        ) continue;
        if (range.to <= view.viewport.from || range.from >= view.viewport.to) {
          if (previous.has(range.groupId)) multiline.add(range.groupId);
          continue;
        }
        const rectangles = RectangleMarker.forRange(
          view,
          "",
          EditorSelection.range(range.from, range.to),
        );
        const start = view.coordsAtPos(range.from, 1);
        const end = view.coordsAtPos(range.to, -1);
        const wraps = start && end
          ? Math.abs(start.top - end.top) > 1
          : previous.has(range.groupId) ||
            state.sliceDoc(range.from, range.to).includes("\n") ||
            rectangles.some((rect) =>
              rect.top !== rectangles[0].top ||
              rect.height > view.defaultLineHeight * 1.5
            );
        const count = doc.groups[range.groupId].optionIds.length;
        const selected = range.groupId === display.groupId;
        const dotClass = `variant-count-dot${
          selected ? " variant-marker-selected" : ""
        }`;
        if (!wraps) {
          const startMarker = RectangleMarker.forRange(
            view,
            "",
            EditorSelection.cursor(range.from, 1),
          )[0];
          const endMarker = RectangleMarker.forRange(
            view,
            "",
            EditorSelection.cursor(range.to, -1),
          )[0];
          if (!startMarker || !endMarker) continue;
          const markerLeft = Math.min(startMarker.left, endMarker.left);
          const width = Math.abs(endMarker.left - startMarker.left);
          const step = Math.min(6, width / (count + 2));
          const size = Math.min(3, step / 2);
          const dotsLeft = markerLeft + width - count * step;
          const top = endMarker.top + endMarker.height;
          markers.push(
            new RectangleMarker(
              `variant-underline${selected ? " variant-marker-selected" : ""}`,
              markerLeft,
              top,
              Math.max(0, width - count * step - 2),
              1.5,
            ),
          );
          for (let i = 0; i < count; i++) {
            markers.push(
              new RectangleMarker(
                dotClass,
                dotsLeft + i * step + (step - size) / 2,
                top + (1.5 - size) / 2,
                size,
                size,
              ),
            );
          }
          continue;
        }
        multiline.add(range.groupId);
        if (!rectangles.length) continue;
        const top = Math.min(...rectangles.map((rect) => rect.top));
        const bottom = Math.max(
          ...rectangles.map((rect) => rect.top + rect.height),
        );
        const markerLeft = Math.max(2, left - 8 - range.ancestors.length * 4);
        const step = Math.min(6, (bottom - top) / (count + 1));
        const size = Math.min(3, step / 2);
        const ruleHeight = bottom - top - count * step;
        markers.push(
          new RectangleMarker(
            `variant-border ${selected ? "variant-marker-selected" : ""}`,
            markerLeft,
            top,
            2,
            ruleHeight,
          ),
        );
        for (let i = 0; i < count; i++) {
          markers.push(
            new RectangleMarker(
              dotClass,
              markerLeft + (2 - size) / 2,
              top + ruleHeight + (i + 1) * step - size,
              size,
              size,
            ),
          );
        }
      }
      if (
        multiline.size !== previous.size ||
        [...multiline].some((id) => !previous.has(id))
      ) {
        // Measuring may read layout, but transactions must wait until it finishes.
        queueMicrotask(() => {
          if (view.state === state && view.dom.isConnected) {
            view.dispatch({ effects: setMultilineVariants.of(multiline) });
          }
        });
      }
      return markers;
    },
  }),
];
