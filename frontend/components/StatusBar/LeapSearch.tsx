import React, { useEffect, useRef } from "react";
import { Input } from "@base-ui/react/input";
import type { EditorHandle, Leap } from "../Editor/index.ts";

export interface LeapSearchProps {
  leap: Leap;
  editor: React.RefObject<EditorHandle | null>;
}

export default function LeapSearch({ leap, editor }: LeapSearchProps) {
  const query = useRef<HTMLInputElement>(null);
  useEffect(() => {
    query.current?.focus();
  }, []);
  const match = leap.matches[leap.index];
  let matchLabel = "";
  if (match) matchLabel = `${leap.index + 1} / ${leap.matches.length}`;
  else if (leap.query) matchLabel = "No matches";
  return (
    <form
      id="leap-form"
      role="search"
      aria-label="Leap through writing"
      onSubmit={(event) => {
        event.preventDefault();
        if (match) editor.current?.closeLeap(match.from);
      }}
    >
      <label htmlFor="query">Leap</label>
      <Input
        id="query"
        ref={query}
        autoComplete="off"
        spellCheck={false}
        aria-label="Leap pattern"
        value={leap.query}
        onValueChange={(value) => editor.current?.search(value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (
            event.ctrlKey && !event.metaKey && !event.altKey &&
            !event.shiftKey && event.key.toLowerCase() === "c"
          ) {
            event.preventDefault();
            event.stopPropagation();
            editor.current?.closeLeap();
          }
        }}
      />
      <span id="matches" role="status">
        {matchLabel}
      </span>
    </form>
  );
}
