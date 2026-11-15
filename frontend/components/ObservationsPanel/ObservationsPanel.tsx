import React from "react";
import { Button } from "@base-ui/react/button";
import type {
  AnalysisInput,
  AnalysisResult,
  Focus,
} from "../../../shared/types.ts";
import Observation from "./Observation.tsx";

interface Props {
  focus: Focus;
  input: AnalysisInput;
  message: string;
  data?: AnalysisResult;
  close: () => void;
}

export default function ObservationsPanel(props: Props) {
  const { focus, input, data, message } = props;
  const findings =
    data?.observations.filter((finding) =>
      input.rules.some((rule) => rule.id === finding.ruleId) &&
      focus.text.slice(finding.start, finding.end) === finding.quote
    ) ?? [];
  let emptyMessage = message;
  if (!emptyMessage && !data) {
    emptyMessage = "Observations will appear after a pause.";
  }
  if (!emptyMessage && !findings.length) {
    emptyMessage = "No matches in this paragraph.";
  }
  return (
    <section aria-label="Observations">
      <div className="panel-head">
        <h2>Observations</h2>
        <Button
          type="button"
          id="close-panel"
          aria-label="Close observations"
          onClick={props.close}
        >
          ×
        </Button>
      </div>
      <div id="findings">
        {emptyMessage
          ? <p className="empty">{emptyMessage}</p>
          : findings.map((finding) => (
            <Observation
              key={finding.ruleId}
              finding={finding}
              rule={input.rules.find((rule) => rule.id === finding.ruleId)!}
            />
          ))}
      </div>
    </section>
  );
}
