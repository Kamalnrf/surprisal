/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React, { useState } from "https://esm.sh/react@19.3.0";
import { Button } from "https://esm.sh/@base-ui/react@1.9.0/button?deps=react@19.3.0,react-dom@19.3.0";
import { Collapsible } from "https://esm.sh/@base-ui/react@1.9.0/collapsible?deps=react@19.3.0,react-dom@19.3.0";
import { BREAK, GUIDE } from "../../../shared/stream.ts";
import {
  clearWriting,
  downloadDocument,
  downloadWriting,
} from "../../helpers/storage.ts";
import { writingStore } from "../../stores/writing.ts";

export default function Guide({
  text,
  recovered,
  ruleErrors,
  insertGuide,
  changeKey,
  showIntro,
  sourceUrl,
}: {
  text: string;
  recovered: string;
  ruleErrors: string[];
  insertGuide: () => void;
  changeKey: () => void;
  showIntro: () => void;
  sourceUrl: string;
}) {
  // Two clicks: the first arms the reset, the second erases.
  const [resetArmed, setResetArmed] = useState(false);
  return (
    <Collapsible.Root className="disclosure">
      <Collapsible.Trigger className="disclosure-trigger">
        Guide &amp; privacy
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {ruleErrors.length > 0 && <p role="status">Rules need attention</p>}
        <p>
          <strong>Rules.</strong>{" "}
          Write one rule per bullet in @rules, or @rules - a rule on any line.
          Only those rules are checked; @ignore switches one off.
        </p>
        <p>
          <strong>Analysis.</strong>{" "}
          Jev receives your current paragraph, nearby context and rules through
          this Val—not your full stream.
        </p>
        <p>
          <strong>Writing.</strong>{" "}
          Saved in this browser, not synced. Download backups—browser data can
          be cleared or lost.
        </p>
        <p>
          <strong>Key.</strong>{" "}
          Remembered keys are unencrypted and accessible to this site’s scripts.
          Use a trusted browser. Otherwise, your key stays in this tab. The
          server does not save it.
        </p>
        <Button type="button" className="link" onClick={showIntro}>
          Show the introduction
        </Button>
        <Button
          type="button"
          className="link"
          onClick={() => {
            insertGuide();
            writingStore.append(BREAK + GUIDE);
          }}
        >
          Insert a copy of the guide
        </Button>
        <Button
          type="button"
          className="link"
          onClick={() => downloadWriting(text)}
        >
          Download writing
        </Button>
        <Button
          type="button"
          className="link"
          onClick={() => downloadDocument(writingStore.getSnapshot().document)}
        >
          Download writing with variants (JSON)
        </Button>
        <Button
          type="button"
          className="link reset-writing"
          data-armed={resetArmed}
          onBlur={() => setResetArmed(false)}
          onClick={() =>
            resetArmed
              ? void writingStore.reset(clearWriting)
              : setResetArmed(true)}
        >
          {resetArmed
            ? "Click again to erase all writing in this browser"
            : "Reset all writing…"}
        </Button>
        <Button type="button" className="link" onClick={changeKey}>
          Jev key settings
        </Button>
        <p>
          <a href={sourceUrl} target="_top">View source</a>
        </p>
        {recovered && (
          <Collapsible.Root className="disclosure">
            <Collapsible.Trigger className="disclosure-trigger">
              Previously saved writing
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <p className="pre">{recovered}</p>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
