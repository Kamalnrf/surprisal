/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React from "https://esm.sh/react@19.3.0";
import { Button } from "https://esm.sh/@base-ui/react@1.9.0/button?deps=react@19.3.0,react-dom@19.3.0";
import { ListMagnifyingGlassIcon } from "https://esm.sh/@phosphor-icons/react@2.1.10/dist/csr/ListMagnifyingGlass?deps=react@19.3.0,react-dom@19.3.0";

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
