import React from "react";
import { Button } from "@base-ui/react/button";
import { ListMagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/ListMagnifyingGlass";

export interface StatusBarProps {
  section: number;
  count: number;
  words: number;
  search?: React.ReactNode;
  actions?: React.ReactNode;
  inspect: () => void;
  error?: string;
  children: React.ReactNode;
}

export default function StatusBar({
  section,
  count,
  words,
  search,
  actions,
  inspect,
  error,
  children,
}: StatusBarProps) {
  return (
    <footer className="bar">
      {search ?? (
        <>
          <span aria-label={`Current section ${section}/${count}`}>
            Section {section}/{count}
          </span>
          <span id="word-count" aria-label="Words in current section">
            {words} words
          </span>
        </>
      )}
      {actions}
      <div className="rail-actions" role="group" aria-label="Writing tools">
        <Button
          type="button"
          id="inspect-predictions"
          className={`rail-icon ${error ? "has-error" : ""}`}
          aria-label="Inspect predictions"
          title={error
            ? "Inspect predictions — analysis failed"
            : "Inspect predictions"}
          aria-haspopup="dialog"
          aria-controls="predictions-debug"
          onClick={inspect}
        >
          <ListMagnifyingGlassIcon size={18} aria-hidden="true" />
          {error && (
            <span className="rail-error" role="status">Analysis failed</span>
          )}
        </Button>
        {children}
      </div>
    </footer>
  );
}
