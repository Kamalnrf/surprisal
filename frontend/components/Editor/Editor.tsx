import React, {
  forwardRef,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  undo,
} from "@codemirror/commands";
import {
  BREAK,
  ignoredLines,
  leapMatches,
  ruleLines,
  sections,
} from "../../../shared/stream.ts";
import { downloadWriting } from "../../helpers/storage.ts";
import { writingStore } from "../../stores/writing.ts";
import type { EditorHandle, EditorSnapshot, Leap } from "./Editor.types.ts";
import type { Heat } from "../../../shared/surprisal.ts";
import { markdownEditing } from "./markdown.ts";
import { typing } from "./typing.ts";
import {
  activateOption,
  addOption,
  createGroup,
  editOption,
  inferVariantKind,
  removeOption,
  unwrapGroup,
  visibleGroups,
} from "../../../shared/variants.ts";
import {
  documentField,
  documentHistory,
  documentTransaction,
  setVariantDisplay,
  sidebarEdit,
  textChange,
  variantDecorations,
  variantDisplay,
} from "./variants.ts";

interface Props {
  onChange: (
    state: EditorSnapshot,
    docChanged: boolean,
    fromSidebar: boolean,
  ) => void;
  onLeap: (leap: Leap | null) => void;
  variantsOn: boolean;
  activeVariant: string | null;
  onVariant: (groupId: string) => void;
  onFocusVariants: () => void;
  // A warm word was tapped or clicked; its selection follows.
  onWord: () => void;
  smartPunctuation: boolean;
  // Keep the line being written in the middle of the screen.
  typewriter: boolean;
}

const setHeat = StateEffect.define<Heat[]>();
function markFor(h: Heat) {
  switch (h.kind) {
    case "stock":
      return Decoration.mark({
        class: "stock-phrase",
        attributes: { title: "Stock phrase: the model finished it for you" },
      });
    case "echo":
      return Decoration.mark({
        class: "echo-phrase",
        attributes: {
          title: "Echo: the model predicted your own earlier words",
        },
      });
    case "sentence":
      return Decoration.mark({
        class: "autopilot-sentence",
        attributes: {
          title:
            `Expected: on average the model guessed each word here at about 1 in ${
              Math.round(1 / h.p)
            }`,
        },
      });
    default:
      return Decoration.mark({
        class: "autopilot",
        word: true,
        attributes: {
          style: `--heat:${h.p.toFixed(2)}`,
          title: `The model's first guess · ${Math.round(h.p * 100)}%`,
        },
      });
  }
}
// Autopilot marks follow edits until the next reading replaces them.
const heatField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    const heat = transaction.effects.findLast((effect) => effect.is(setHeat));
    if (!heat) {
      // An edited word is no longer the word that was read; drop its mark.
      const edited: [number, number][] = [];
      transaction.changes.iterChangedRanges((_fromA, _toA, from, to) => {
        edited.push([from, to]);
      });
      return marks.map(transaction.changes).update({
        filter: (from, to) => !edited.some(([f, t]) => from <= t && f <= to),
      });
    }
    return Decoration.set(
      heat.value.filter((h) => h.to <= transaction.state.doc.length).map((h) =>
        markFor(h).range(h.from, h.to)
      ),
      true,
    );
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // The selection layer sits under the warm background; outline the
    // inspected word so it still reads as selected.
    EditorView.decorations.compute(["selection", field], (state) => {
      const { from, to } = state.selection.main;
      let exact = false;
      state.field(field).between(from, to, (f, t, mark) => {
        if (f === from && t === to && mark.spec.word) exact = true;
      });
      return exact && from < to
        ? Decoration.set(
          Decoration.mark({ class: "autopilot-selected" }).range(from, to),
        )
        : Decoration.none;
    }),
  ],
});

// CodeMirror owns document transactions and undo; React owns surrounding UI.
export default forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const liveView = useRef<EditorView | null>(null);
  const onChange = useEffectEvent(props.onChange);
  const onLeap = useEffectEvent(props.onLeap);
  const onVariant = useEffectEvent(props.onVariant);
  const onFocusVariants = useEffectEvent(props.onFocusVariants);
  const onWord = useEffectEvent(props.onWord);
  // Read at typing time, so toggling needs no editor rebuild.
  const settings = useRef(props);
  settings.current = props;

  useEffect(() => {
    liveView.current?.dispatch({
      effects: setVariantDisplay.of({
        enabled: props.variantsOn,
        groupId: props.activeVariant,
      }),
    });
  }, [props.variantsOn, props.activeVariant]);

  useEffect(() => {
    let leap: Leap | null = null;
    let composing = false;
    let sidebarHistory = false;
    let altTap: { code: string; used: boolean } | null = null;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = StateEffect.define<null>();
    const editable = new Compartment();
    function decorate(state: EditorState) {
      const text = state.doc.toString();
      const ranges = [];
      const tagged = new Set<number>();
      for (const section of sections(text)) {
        const match = /(?<![\w@])@[\p{L}\p{N}_-]+/u.exec(section.text);
        if (match) {
          tagged.add(section.start + match.index);
          ranges.push(
            Decoration.mark({ class: "section-tag" }).range(
              section.start + match.index,
              section.start + match.index + match[0].length,
            ),
          );
        }
      }
      for (const line of ruleLines(text)) {
        const at = line.from + text.slice(line.from).indexOf("@rules");
        if (tagged.has(at)) continue;
        ranges.push(
          Decoration.mark({ class: "section-tag" }).range(at, at + 6),
        );
      }
      for (const line of ignoredLines(text)) {
        if (line.to > line.from) {
          ranges.push(
            Decoration.mark({
              class: "ignored-line",
              attributes: { title: "Skipped with @ignore" },
            }).range(line.from, line.to),
          );
        }
      }
      for (const match of text.matchAll(/^\f\r?$/gm)) {
        ranges.push(
          Decoration.line({
            class: "cm-section-break",
            attributes: { "aria-label": "Section break" },
          }).range(match.index!),
        );
      }
      if (leap) {
        leap.matches.forEach((match, index) =>
          ranges.push(
            Decoration.mark({
              class: index === leap!.index ? "leap-current" : "leap-match",
            }).range(match.from, match.to),
          )
        );
      }
      return Decoration.set(ranges, true);
    }
    const marks = StateField.define({
      create: decorate,
      update: (value, transaction) => {
        if (
          transaction.docChanged ||
          transaction.effects.some((effect) => effect.is(refresh))
        ) return decorate(transaction.state);
        return value;
      },
      provide: (field) => EditorView.decorations.from(field),
    });
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: writingStore.getSnapshot().text,
        // Open where writing continues: the end of the last section.
        selection: { anchor: writingStore.getSnapshot().text.length },
        extensions: [
          history(),
          documentField.init(() => writingStore.getSnapshot().document),
          documentHistory,
          variantDisplay.init(() => ({
            enabled: props.variantsOn,
            groupId: props.activeVariant,
          })),
          variantDecorations,
          heatField,
          drawSelection(),
          EditorView.lineWrapping,
          markdownEditing,
          typing(() => settings.current.smartPunctuation),
          // Follow edits, not manual scrolling or Leap's preview transactions.
          EditorState.transactionExtender.of((transaction) =>
            transaction.docChanged && !leap &&
              !transaction.annotation(sidebarEdit) && !sidebarHistory
              ? {
                effects: EditorView.scrollIntoView(
                  transaction.state.selection.main.head,
                  settings.current.typewriter
                    ? { y: "center" }
                    : { y: "nearest", yMargin: 32 },
                ),
              }
              : null
          ),
          editable.of(EditorState.readOnly.of(false)),
          marks,
          EditorView.contentAttributes.of({
            "aria-label": "Your writing",
            spellcheck: "true",
            autocapitalize: "sentences",
          }),
          keymap.of([
            {
              key: "Mod-Shift-Enter",
              run: () => {
                if (
                  leap || !view.state.field(variantDisplay).enabled ||
                  view.state.selection.main.empty
                ) return false;
                onFocusVariants();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                insertBreak();
                return true;
              },
            },
            {
              key: "Mod-Shift-s",
              run: () => {
                downloadWriting(view.state.doc.toString());
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            compositionstart() {
              composing = true;
              emit();
            },
            compositionend() {
              composing = false;
              queueMicrotask(emit);
            },
            pointerdown(event) {
              if (!leap) return false;
              const target = (event.target as HTMLElement).closest(
                ".leap-current,.leap-match",
              );
              const pos = target ? view.posAtDOM(target, 0) : null;
              const match = leap.matches.find((match) =>
                pos !== null && pos >= match.from && pos < match.to
              );
              event.preventDefault();
              if (match) closeLeap(match.from);
              return true;
            },
            click(event) {
              if (leap || !view.state.selection.main.empty) return false;
              const target = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-variant]",
              );
              if (
                target?.dataset.variant &&
                view.state.field(variantDisplay).enabled
              ) {
                onVariant(target.dataset.variant);
                return false;
              }
              // Clicking a warm word selects it, which opens its guesses and variants.
              // Read the tapped position: on touch, click fires before the
              // editor's selection has caught up with the tap.
              const head =
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                  view.state.selection.main.head;
              view.state.field(heatField).between(
                head,
                head,
                (from, to, mark) => {
                  if (mark.spec.word && from <= head && head <= to) {
                    onWord();
                    view.dispatch({ selection: { anchor: from, head: to } });
                    return false;
                  }
                },
              );
              return false;
            },
          }),
          // Surprisal marks fade while typing and return after a pause,
          // so they read as revision notes, not interruptions.
          EditorView.updateListener.of((update) => {
            if (
              !update.transactions.some((tr) =>
                tr.isUserEvent("input") || tr.isUserEvent("delete")
              )
            ) return;
            update.view.dom.classList.add("typing");
            clearTimeout(typingTimer);
            typingTimer = setTimeout(
              () => update.view.dom.classList.remove("typing"),
              1200,
            );
          }),
          EditorView.updateListener.of((update) => {
            const graphChanged = update.startState.field(documentField) !==
              update.state.field(documentField);
            if (graphChanged || (update.selectionSet && !leap)) {
              emit(
                update.docChanged,
                sidebarHistory ||
                  update.transactions.some((tr) =>
                    !!tr.annotation(sidebarEdit)
                  ),
                graphChanged,
              );
            }
          }),
        ],
      }),
    });
    liveView.current = view;
    const openVariant = (event: Event) =>
      onVariant((event as CustomEvent<string>).detail);
    view.dom.addEventListener("open-variant", openVariant);

    function emit(
      docChanged = false,
      fromSidebar = false,
      graphChanged = false,
    ) {
      const text = view.state.doc.toString();
      if (graphChanged) {
        writingStore.acceptEditorDocument(view.state.field(documentField));
      }
      onChange(
        {
          text,
          document: view.state.field(documentField),
          head: view.state.selection.main.head,
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
          composing,
          leaping: !!leap,
        },
        docChanged,
        fromSidebar,
      );
    }
    function insert(from: number, to: number, text: string) {
      if (leap) closeLeap();
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
    }
    function insertBreak() {
      if (leap) closeLeap();
      const selection = view.state.selection.main;
      insert(selection.from, selection.to, BREAK);
    }
    function showMatch() {
      if (!leap) return;
      const match = leap.matches[leap.index];
      view.dispatch({
        effects: [
          refresh.of(null),
          ...(match
            ? [EditorView.scrollIntoView(match.from, { y: "center" })]
            : []),
        ],
      });
      if (!match) view.scrollDOM.scrollTop = leap.scroll;
      onLeap({ ...leap });
    }
    function openLeap(direction: 1 | -1 = 1) {
      if (leap) {
        if (leap.matches.length) {
          leap.index = (leap.index + direction + leap.matches.length) %
            leap.matches.length;
        }
        showMatch();
        return;
      }
      leap = {
        origin: view.state.selection,
        scroll: view.scrollDOM.scrollTop,
        matches: [],
        index: -1,
        direction,
        query: "",
      };
      view.dispatch({
        effects: [
          editable.reconfigure(EditorState.readOnly.of(true)),
          refresh.of(null),
        ],
      });
      onLeap({ ...leap });
      emit();
    }
    function closeLeap(position?: number) {
      if (!leap) return;
      const previous = leap;
      leap = null;
      view.dispatch({
        selection: position === undefined
          ? previous.origin
          : { anchor: position },
        effects: [
          editable.reconfigure(EditorState.readOnly.of(false)),
          refresh.of(null),
        ],
        scrollIntoView: position !== undefined,
      });
      view.focus();
      if (position === undefined) view.scrollDOM.scrollTop = previous.scroll;
      onLeap(null);
      emit();
    }
    function search(query: string) {
      if (!leap) return;
      leap.query = query;
      leap.matches = leapMatches(view.state.doc.toString(), query);
      leap.index = leap.direction === 1
        ? leap.matches.findIndex((match) =>
          match.from >= leap!.origin.main.head
        )
        : leap.matches.findLastIndex((match) =>
          match.from < leap!.origin.main.head
        );
      if (leap.index < 0 && leap.matches.length) {
        leap.index = leap.direction === 1 ? 0 : leap.matches.length - 1;
      }
      showMatch();
    }
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || event.getModifierState("AltGraph")) {
        altTap = null;
        return;
      }
      if (leap && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        altTap = null;
        closeLeap();
        return;
      }
      if (
        event.key === "Alt" && !event.repeat && !event.ctrlKey &&
        !event.metaKey && !event.shiftKey && (view.hasFocus || leap)
      ) altTap = { code: event.code, used: false };
      else if (event.key !== "Alt" && altTap) altTap.used = true;
    }
    function keyup(event: KeyboardEvent) {
      if (event.key !== "Alt") return;
      const tap = altTap;
      altTap = null;
      if (
        !tap || tap.used || event.isComposing ||
        !["AltLeft", "AltRight"].includes(tap.code)
      ) return;
      event.preventDefault();
      openLeap(tap.code === "AltLeft" ? -1 : 1);
    }
    const blur = () => {
      altTap = null;
    };
    let viewportFrame = 0;
    // The tallest visual viewport at this width: the screen without a keyboard.
    let full = { width: 0, height: 0 };
    function viewport() {
      cancelAnimationFrame(viewportFrame);
      viewportFrame = requestAnimationFrame(() => {
        const viewport = globalThis.visualViewport;
        if (viewport && viewport.scale !== 1) return;
        document.documentElement.style.setProperty(
          "--app-height",
          `${viewport?.height ?? innerHeight}px`,
        );
        // An on-screen keyboard shrinks the visual viewport well below the
        // tallest seen at this width; the bar then gets out of the way.
        if (viewport) {
          if (viewport.width !== full.width) {
            full = { width: viewport.width, height: 0 };
          }
          full.height = Math.max(full.height, viewport.height);
        }
        document.documentElement.toggleAttribute(
          "data-keyboard",
          !!viewport && full.height - viewport.height > 150,
        );
        document.documentElement.style.setProperty(
          "--viewport-top",
          `${Math.max(0, viewport?.offsetTop ?? 0)}px`,
        );
        view.requestMeasure();
        if (view.hasFocus && !leap) {
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, {
              y: "nearest",
            }),
          });
        }
      });
    }
    const handle: EditorHandle = {
      createVariant(from, to, text) {
        const created = createGroup(
          view.state.field(documentField),
          from,
          to,
          inferVariantKind(view.state.doc.toString(), from, to),
        );
        const added = addOption(created.document, created.groupId, text);
        view.dispatch(documentTransaction(view.state, added.document));
        return created.groupId;
      },
      addVariant(groupId, text) {
        view.dispatch(
          documentTransaction(
            view.state,
            addOption(view.state.field(documentField), groupId, text).document,
          ),
        );
      },
      activateVariant(groupId, optionId) {
        view.dispatch(
          documentTransaction(
            view.state,
            activateOption(view.state.field(documentField), groupId, optionId),
          ),
        );
      },
      editVariant(groupId, text) {
        const doc = view.state.field(documentField);
        const range = visibleGroups(doc).find((range) =>
          range.groupId === groupId
        );
        if (!range) return;
        const change = textChange(
          view.state.doc.sliceString(range.from, range.to),
          text,
        );
        if (change.from === change.to && !change.text) return;
        view.dispatch(
          documentTransaction(
            view.state,
            editOption(doc, groupId, change.from, change.to, change.text),
            false,
          ),
        );
      },
      removeVariant(groupId, optionId) {
        view.dispatch(
          documentTransaction(
            view.state,
            removeOption(view.state.field(documentField), groupId, optionId),
          ),
        );
      },
      unwrapVariant(groupId) {
        view.dispatch(
          documentTransaction(
            view.state,
            unwrapGroup(view.state.field(documentField), groupId),
          ),
        );
      },
      undo: () => {
        sidebarHistory = true;
        try {
          undo(view);
        } finally {
          sidebarHistory = false;
        }
      },
      redo: () => {
        sidebarHistory = true;
        try {
          redo(view);
        } finally {
          sidebarHistory = false;
        }
      },
      insert,
      insertBreak,
      openLeap,
      closeLeap,
      search,
      focus(position) {
        // Focus first: focusing reads the browser's stale DOM selection back
        // into the editor, which would overwrite a selection set before it.
        view.focus();
        view.dispatch({
          selection: { anchor: position },
          scrollIntoView: true,
        });
      },
      measure: () => view.requestMeasure(),
      setHeat: (heat) => view.dispatch({ effects: setHeat.of(heat) }),
      select(from, to) {
        view.focus();
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true,
        });
      },
      reveal() {
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.from, {
            y: "start",
            yMargin: 72,
          }),
        });
      },
    };
    const disconnect = writingStore.connectEditor(({ from, to, text }) =>
      insert(from, to, text)
    );
    if (typeof ref === "function") ref(handle);
    else if (ref) ref.current = handle;
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    globalThis.addEventListener("blur", blur);
    globalThis.addEventListener("resize", viewport);
    globalThis.visualViewport?.addEventListener("resize", viewport);
    globalThis.visualViewport?.addEventListener("scroll", viewport);
    viewport();
    view.focus();
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.length, {
        y: "center",
      }),
    });
    emit();
    return () => {
      clearTimeout(typingTimer);
      disconnect();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      globalThis.removeEventListener("blur", blur);
      globalThis.removeEventListener("resize", viewport);
      globalThis.visualViewport?.removeEventListener("resize", viewport);
      globalThis.visualViewport?.removeEventListener("scroll", viewport);
      cancelAnimationFrame(viewportFrame);
      liveView.current = null;
      view.dom.removeEventListener("open-variant", openVariant);
      view.destroy();
      if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, []);
  return (
    <section className="writing" aria-label="Writing">
      <div id="editor" ref={container} />
    </section>
  );
});
