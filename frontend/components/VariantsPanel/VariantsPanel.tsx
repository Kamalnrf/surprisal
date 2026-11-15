import React, {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@base-ui/react/button";
import { Popover } from "@base-ui/react/popover";
import type { EditorHandle } from "../Editor/Editor.types.ts";
import {
  renderDocument,
  visibleGroups,
  type WritingDocument,
} from "../../../shared/variants.ts";

interface Props {
  document: WritingDocument;
  groupId: string | null;
  selection: { from: number; to: number; text: string } | null;
  editor: React.RefObject<EditorHandle | null>;
  selectGroup: (groupId: string) => void;
  close: () => void;
}

// Text remains native and multiline; grow rows as text or the sidebar width changes.
function VariantText(props: React.ComponentProps<"textarea">) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = field.current!;
    const resize = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    resize();
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = node.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={field} rows={1} />;
}

function VariantDraft({ onAdd, onDiscard }: {
  onAdd: (text: string) => void;
  onDiscard?: (returnFocus: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const composing = useRef(false);
  const submitted = useRef(false);
  function add(value: string) {
    setText(value);
    if (!value.trim() || composing.current || submitted.current) {
      return;
    }
    try {
      onAdd(value);
      submitted.current = true;
      setText("");
      setError("");
    } catch {
      setError(
        "Select writing inside a variant, or include it completely. A selection cannot cross an existing variant’s boundary.",
      );
    }
  }
  return (
    <>
      <li className="variant-row variant-draft">
        <span className="variant-select" aria-hidden="true">·</span>
        <VariantText
          id="variant-add"
          aria-label="Add an alternative"
          aria-describedby="variant-hint"
          placeholder="Add an alternative…"
          value={text}
          onFocus={() => {
            submitted.current = false;
          }}
          onBlur={() => onDiscard?.(false)}
          onChange={(event) => add(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              onDiscard && !text && !event.metaKey && !event.ctrlKey &&
              !event.altKey && !event.shiftKey &&
              ["Backspace", "ArrowUp", "ArrowLeft"].includes(event.key)
            ) {
              event.preventDefault();
              event.stopPropagation();
              onDiscard(true);
              return;
            }
            if (
              event.key !== "Enter" || event.shiftKey
            ) return;
            event.preventDefault();
            event.stopPropagation();
            add(text);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            add(event.currentTarget.value);
          }}
        />
      </li>
      {error && <li className="error" role="alert">{error}</li>}
    </>
  );
}

export default function VariantsPanel(
  { document, groupId, selection, editor, selectGroup, close }: Props,
) {
  const panel = useRef<HTMLElement>(null);
  const focusNewRow = useRef(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const groups = visibleGroups(document);
  const range = groups.find((range) => range.groupId === groupId);
  const group = range ? document.groups[range.groupId] : undefined;
  const textOf = (id: string) =>
    renderDocument({ ...document, root: document.options[id].parts });

  // Focus after React commits the new row, before the next keystroke can arrive.
  useLayoutEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const field = panel.current?.querySelector<HTMLTextAreaElement>(
      draft
        ? "#variant-add"
        : ".variant-row[data-active=true] textarea, #variant-add",
    );
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
  });
  function choose(optionId: string) {
    if (group && optionId !== group.activeOptionId) {
      editor.current?.activateVariant(group.id, optionId);
    }
  }
  function choiceKey(event: React.KeyboardEvent, index: number) {
    if (
      !group || event.nativeEvent.isComposing || event.metaKey ||
      event.ctrlKey || event.altKey || event.shiftKey
    ) return;
    const field = event.currentTarget;
    const editing = field instanceof HTMLTextAreaElement;
    if (editing) {
      if (field.selectionStart !== field.selectionEnd) return;
      if (event.key === "ArrowLeft" && field.selectionStart > 0) return;
      if (
        event.key === "ArrowRight" && field.selectionEnd < field.value.length
      ) return;
      if (event.key === "Home" || event.key === "End") return;
    }
    let target: number;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      target = (index - 1 + group.optionIds.length) % group.optionIds.length;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      target = (index + 1) % group.optionIds.length;
    } else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = group.optionIds.length - 1;
    else return;
    event.preventDefault();
    if (editing) {
      if (target !== index) {
        focusNewRow.current = true;
        choose(group.optionIds[target]);
      }
      return;
    }
    choose(group.optionIds[target]);
    panel.current?.querySelector<HTMLButtonElement>(
      `[data-option="${group.optionIds[target]}"]`,
    )?.focus({ preventScroll: true });
  }
  return (
    <section
      className="variants-panel"
      aria-label="Variants"
      ref={panel}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          !(event.target instanceof HTMLTextAreaElement)
        ) return;
        if (
          (event.metaKey || event.ctrlKey) && !event.altKey &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          focusNewRow.current = true;
          setDraft(false);
          if (event.shiftKey || event.key.toLowerCase() === "y") {
            editor.current
              ?.redo();
          } else editor.current?.undo();
        } else if (event.key === "Enter" && !event.shiftKey && group) {
          event.preventDefault();
          focusNewRow.current = true;
          setDraft(true);
        } else if (
          event.key === "Backspace" && !event.target.value &&
          event.target.id !== "variant-add" && group &&
          group.optionIds.length > 1
        ) {
          event.preventDefault();
          focusNewRow.current = true;
          editor.current?.removeVariant(group.id, group.activeOptionId);
        }
      }}
    >
      <div className="panel-head">
        <h2>Variants</h2>
        {group && (
          <Popover.Root open={actionsOpen} onOpenChange={setActionsOpen}>
            <Popover.Trigger
              className="variant-more"
              aria-label="Variant actions"
              title="Variant actions"
            >
              ···
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                className="rail-menu-positioner"
                side="bottom"
                align="end"
                sideOffset={4}
                collisionPadding={12}
              >
                <Popover.Popup className="rail-menu variant-menu">
                  <Popover.Title>Variant actions</Popover.Title>
                  <Button
                    type="button"
                    className="link"
                    disabled={group.optionIds.length < 2}
                    onClick={() => {
                      editor.current?.removeVariant(
                        group.id,
                        group.activeOptionId,
                      );
                      setActionsOpen(false);
                    }}
                  >
                    Remove current version
                  </Button>
                  <Button
                    type="button"
                    className="link"
                    onClick={() => {
                      editor.current?.unwrapVariant(group.id);
                      setActionsOpen(false);
                      close();
                    }}
                  >
                    Keep only current version
                  </Button>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )}
        <Button type="button" aria-label="Close variants" onClick={close}>
          ×
        </Button>
      </div>
      {group || selection
        ? (
          <div className="variant-body">
            {range && range.ancestors.length > 0 && (
              <nav className="variant-path" aria-label="Containing variants">
                {range.ancestors.map((id) => (
                  <Button
                    type="button"
                    key={id}
                    onClick={() => selectGroup(id)}
                  >
                    {document.groups[id].kind} ›
                  </Button>
                ))}
              </nav>
            )}
            <ul className="variant-list" aria-label="Alternatives">
              {group
                ? group.optionIds.map((id, index) => (
                  <li
                    className="variant-row"
                    data-active={id === group.activeOptionId}
                    key={id}
                  >
                    <Button
                      type="button"
                      className="variant-select"
                      data-option={id}
                      aria-label={`Use version ${index + 1}: ${
                        textOf(id) || "omitted passage"
                      }`}
                      aria-pressed={id === group.activeOptionId}
                      tabIndex={id === group.activeOptionId ? 0 : -1}
                      onClick={() => choose(id)}
                      onKeyDown={(event) => choiceKey(event, index)}
                    >
                      {id === group.activeOptionId ? "●" : "○"}
                    </Button>
                    <VariantText
                      aria-label={`Version ${index + 1}`}
                      aria-describedby="variant-hint"
                      value={textOf(id)}
                      onFocus={() => choose(id)}
                      onKeyDown={(event) => choiceKey(event, index)}
                      onChange={(event) =>
                        editor.current?.editVariant(
                          group.id,
                          event.target.value,
                        )}
                    />
                  </li>
                ))
                : (
                  <li className="variant-row" data-active="true">
                    <span className="variant-select" aria-hidden="true">●</span>
                    <span className="variant-original">{selection!.text}</span>
                  </li>
                )}
              {(group ? draft : selection) && (
                <VariantDraft
                  key={group?.id ??
                    `${selection!.from}:${selection!.to}:${selection!.text}`}
                  onDiscard={group
                    ? (returnFocus) => {
                      focusNewRow.current = returnFocus;
                      setDraft(false);
                    }
                    : undefined}
                  onAdd={(text) => {
                    focusNewRow.current = true;
                    if (group) {
                      editor.current?.addVariant(group.id, text);
                      setDraft(false);
                    } else {
                      const id = editor.current?.createVariant(
                        selection!.from,
                        selection!.to,
                        text,
                      );
                      if (id) selectGroup(id);
                    }
                  }}
                />
              )}
            </ul>
            <p className="small variant-hint" id="variant-hint">
              return adds · esc closes
            </p>
            {group &&
              groups.some((child) => child.ancestors.at(-1) === group.id) && (
              <nav className="variant-children" aria-label="Nested variants">
                <p className="small">Inside this version</p>
                {groups.filter((child) => child.ancestors.at(-1) === group.id)
                  .map((child) => (
                    <Button
                      className="link"
                      type="button"
                      key={child.groupId}
                      onClick={() => selectGroup(child.groupId)}
                    >
                      {document.groups[child.groupId].kind} ·{" "}
                      {textOf(document.groups[child.groupId].activeOptionId) ||
                        "(omitted)"}
                    </Button>
                  ))}
              </nav>
            )}
          </div>
        )
        : (
          <p className="empty">
            Select writing or click a marked passage to edit its variants.
          </p>
        )}
    </section>
  );
}
