import React, { useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Collapsible } from "@base-ui/react/collapsible";
import { requestKey } from "../../../shared/stream.ts";
import type {
  AnalysisInput,
  Diagnostics,
  JevAnswer,
} from "../../../shared/types.ts";
import type { Run } from "../../hooks/use-observations.ts";
import { formatScore } from "../../helpers/score.ts";
import { STATUS_LABEL } from "../../helpers/analysis.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  location: string;
  input: AnalysisInput;
  run?: Run;
  // Why analysis is not running for the current writing, if it is not.
  paused: string;
  retry: () => void;
}

function time(value?: number) {
  return value
    ? new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    : "";
}

export default function PredictionsDebug(props: Props) {
  const { open, run, input } = props;
  const status = props.paused ? "paused" : run?.status ?? "waiting";

  const reported = run?.data?.diagnostics ?? run?.diagnostics;
  // The server echoes the input it analyzed. Show answers only when that echo
  // is the writing and rules in focus now, so nothing is misattributed.
  const matches = !!reported &&
    requestKey({
        paragraph: reported.state.paragraph,
        context: reported.state.context,
        rules: reported.rules,
      }) === requestKey(input);
  const diagnostics = status !== "paused" && matches ? reported : undefined;

  let detail = "";
  if (status === "paused") detail = props.paused;
  else if (status === "waiting") {
    detail =
      "Nothing has been sent for this text yet. Questions appear once Jev answers.";
  } else if (status === "asking") {
    detail =
      "Questions are with Jev. Answers appear when the request finishes.";
  } else if (status === "failed") {
    detail = run!.error! +
      (diagnostics
        ? " The questions sent and any scores Jev returned are below."
        : " The server returned no question data for this run.");
  } else if (status === "current") {
    detail = `Answered by Jev at ${time(run!.answeredAt)} · ${
      run!.data!.model ?? "no model call"
    }`;
  } else {
    detail = `Reused this tab's answer from ${
      time(run!.answeredAt)
    } for identical text, context and rules · ${
      run!.data!.model ?? "no model call"
    }`;
  }
  if (reported && !matches && status !== "paused") {
    detail +=
      " This run's echoed input does not match the current writing, so its answers are hidden.";
  } else if (run?.data && !reported) {
    detail += " This server did not return question-level data.";
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="debug-backdrop" />
        <Dialog.Popup
          id="predictions-debug"
          className="debug"
          finalFocus={() => document.getElementById("inspect-predictions")}
        >
          <header className="debug-head">
            <div>
              <p className="mono">PREDICTIONS</p>
              <Dialog.Title id="debug-title">{props.location}</Dialog.Title>
            </div>
            <Dialog.Close
              type="button"
              className="debug-close"
              aria-label="Close predictions"
            >
              ×
            </Dialog.Close>
          </header>
          <div className={`debug-status status-${status}`} role="status">
            <p>
              <strong>{STATUS_LABEL[status]}</strong>
              <span>{detail}</span>
            </p>
            {status === "failed" && (
              <Button type="button" className="link" onClick={props.retry}>
                Retry
              </Button>
            )}
          </div>
          {diagnostics
            ? (
              <Inspector
                key={run!.key + run!.answeredAt}
                diagnostics={diagnostics}
                failed={status === "failed"}
              />
            )
            : (
              <div className="debug-empty">
                <p>
                  {status === "paused"
                    ? "Predictions are shown only for a run of the writing in focus."
                    : "No answers to show for the writing in focus."}
                </p>
                <p className="small">
                  Answers from earlier text are never shown here.
                </p>
              </div>
            )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Inspector(
  { diagnostics, failed }: { diagnostics: Diagnostics; failed: boolean },
) {
  const { rules, state, answers, threshold } = diagnostics;
  const columns = state.sentences.length;
  const at = (r: number, s: number) => answers[r * columns + s];
  const [active, setActive] = useState(() => {
    let index = answers.findIndex((a) => a.outcome === "shown");
    if (index < 0) {
      index = answers.reduce(
        (best, a, i) =>
          (a.score ?? -1) > (answers[best]?.score ?? -1) ? i : best,
        0,
      );
    }
    return { r: Math.floor(index / columns) || 0, s: index % columns || 0 };
  });
  const [copied, setCopied] = useState("");
  const grid = useRef<HTMLTableElement>(null);
  const detail = useRef<HTMLElement>(null);
  const selected = answers.length ? at(active.r, active.s) : undefined;
  const shown = answers.filter((a) => a.outcome === "shown").length;
  const above = answers.filter((a) => (a.score ?? -1) >= threshold).length;

  function move(r: number, s: number) {
    const next = {
      r: Math.max(0, Math.min(rules.length - 1, r)),
      s: Math.max(0, Math.min(columns - 1, s)),
    };
    setActive(next);
    grid.current?.querySelector<HTMLButtonElement>(
      `[data-cell="${next.r}-${next.s}"]`,
    )?.focus();
  }
  function keyDown(event: React.KeyboardEvent, r: number, s: number) {
    const keys: Record<string, [number, number]> = {
      ArrowUp: [r - 1, s],
      ArrowDown: [r + 1, s],
      ArrowLeft: [r, s - 1],
      ArrowRight: [r, s + 1],
      Home: event.ctrlKey ? [0, 0] : [r, 0],
      End: event.ctrlKey ? [rules.length - 1, columns - 1] : [r, columns - 1],
    };
    const target = keys[event.key];
    if (!target) return;
    event.preventDefault();
    move(...target);
  }

  return (
    <div className="debug-main">
      <section className="debug-grid" aria-labelledby="grid-title">
        <h3 id="grid-title" className="mono">ANSWERS</h3>
        <p className="small">
          {rules.length} rules × {columns} sentences = {answers.length}{" "}
          questions · {above} at or above {threshold.toFixed(2)} ·{" "}
          {failed ? "none accepted" : `${shown} shown`}
        </p>
        <ul className="legend small" aria-label="Legend">
          <li>
            <span className="cell shown">0.93</span> shown in Observations
          </li>
          <li>
            <span className="cell eligible">0.88</span> ≥{" "}
            {threshold.toFixed(2)}, not shown
          </li>
          <li>
            <span className="cell below">0.12</span> below threshold
          </li>
          <li>
            <span className="cell unanswered">—</span> no valid answer
          </li>
        </ul>
        {answers.length > 0
          ? (
            <div className="grid-scroll">
              <table
                ref={grid}
                role="grid"
                className="score-grid"
                aria-labelledby="grid-title"
                aria-describedby="grid-help"
              >
                <thead>
                  <tr>
                    <th scope="col" className="corner">Rule</th>
                    {state.sentences.map((sentence) => (
                      <th
                        key={sentence.id}
                        scope="col"
                        title={sentence.text}
                      >
                        s{sentence.id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, r) => (
                    <tr key={rule.id}>
                      <th scope="row" title={rule.instruction}>
                        <span className="mono">r{r}</span>
                        <span className="rule-text">{rule.instruction}</span>
                      </th>
                      {state.sentences.map((_sentence, s) => {
                        const answer = at(r, s);
                        const isActive = active.r === r && active.s === s;
                        return (
                          <td key={s} aria-selected={isActive}>
                            <Button
                              type="button"
                              data-cell={`${r}-${s}`}
                              tabIndex={isActive ? 0 : -1}
                              className={`cell ${answer.outcome}`}
                              style={{
                                "--score": answer.score ?? 0,
                              } as React.CSSProperties}
                              aria-label={`${answer.name}: ${
                                answer.score === null
                                  ? "no valid answer"
                                  : formatScore(answer.score, threshold)
                              }, ${outcomeLabel(answer.outcome, failed)}`}
                              onClick={() => {
                                setActive({ r, s });
                                if (matchMedia("(max-width:850px)").matches) {
                                  detail.current?.scrollIntoView({
                                    block: "start",
                                  });
                                }
                              }}
                              onKeyDown={(event) => keyDown(event, r, s)}
                            >
                              {answer.score === null
                                ? "—"
                                : formatScore(answer.score, threshold)}
                            </Button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : <p className="empty">No questions were sent for this run.</p>}
        <p id="grid-help" className="small">
          Arrow keys move between answers. Sentence and rule numbers are the IDs
          sent to Jev.
        </p>
        <Collapsible.Root className="sent disclosure">
          <Collapsible.Trigger className="disclosure-trigger">
            Paragraph as sent · {columns} sentences
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <ul>
              {state.sentences.map((sentence) => (
                <li key={sentence.id}>
                  <span className="mono">s{sentence.id}</span> {sentence.text}
                </li>
              ))}
            </ul>
          </Collapsible.Panel>
        </Collapsible.Root>
        <Collapsible.Root className="sent disclosure">
          <Collapsible.Trigger className="disclosure-trigger">
            Neighboring context · {state.context.before.length} before ·{" "}
            {state.context.after.length} after
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <p className="mono">BEFORE</p>
            <p className="pre">{state.context.before || "None"}</p>
            <p className="mono">AFTER</p>
            <p className="pre">{state.context.after || "None"}</p>
          </Collapsible.Panel>
        </Collapsible.Root>
        <div className="debug-actions">
          <Button
            type="button"
            className="link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(diagnostics, null, 2),
                );
                setCopied("Copied run JSON.");
              } catch {
                setCopied("This browser blocked clipboard access.");
              }
            }}
          >
            Copy run JSON
          </Button>
          <span className="small" role="status">{copied}</span>
          <p className="small">
            Includes this paragraph, its context and your rules. Your Jev key is
            never included.
          </p>
        </div>
      </section>
      <section
        ref={detail}
        className="debug-detail"
        aria-labelledby="detail-title"
      >
        <Button
          type="button"
          className="link back-to-grid"
          onClick={() =>
            grid.current?.querySelector<HTMLButtonElement>(
              `[data-cell="${active.r}-${active.s}"]`,
            )?.focus()}
        >
          Back to answers
        </Button>
        {selected && (
          <Detail
            answer={selected}
            ruleLabel={`r${active.r}`}
            rule={rules[active.r].instruction}
            sentence={state.sentences[active.s].text}
            threshold={threshold}
            failed={failed}
            winner={answers.find((a) =>
              a.ruleId === selected.ruleId && a.outcome === "shown"
            )}
          />
        )}
      </section>
    </div>
  );
}

function outcomeLabel(outcome: JevAnswer["outcome"], failed: boolean) {
  if (outcome === "shown") return "shown in Observations";
  if (outcome === "eligible") {
    return failed
      ? "would qualify, run failed"
      : "at or above threshold, not shown";
  }
  if (outcome === "below") return "below threshold";
  return "no valid answer";
}

function Detail(
  { answer, ruleLabel, rule, sentence, threshold, failed, winner }: {
    answer: JevAnswer;
    ruleLabel: string;
    rule: string;
    sentence: string;
    threshold: number;
    failed: boolean;
    winner?: JevAnswer;
  },
) {
  const t = threshold.toFixed(2);
  let outcome = "";
  if (answer.outcome === "shown") {
    outcome =
      `Shown in Observations. This is the first sentence at or above ${t} for this rule, so it became the rule's finding.`;
  } else if (answer.outcome === "eligible") {
    outcome = failed
      ? `At or above ${t}, but this run failed, so no findings were accepted.`
      : `Not shown. At or above ${t}, but ${
        winner?.name ?? "an earlier sentence"
      } was already shown for this rule: one finding per rule, first in sentence order.`;
  } else if (answer.outcome === "below") {
    outcome = `Not shown. Below the ${t} threshold.`;
  } else {
    outcome =
      "Not answered. Jev returned no valid score for this question, so the run failed.";
  }
  return (
    <>
      <p className="mono">QUESTION</p>
      <h3 id="detail-title" className="question-name">{answer.name}</h3>
      <dl>
        <dt>Rule {ruleLabel}</dt>
        <dd>{rule}</dd>
        <dt>Sentence s{answer.sentenceId}</dt>
        <dd>
          <blockquote>
            <span>{sentence}</span>
          </blockquote>
        </dd>
        <dt>Answer</dt>
        <dd>
          {answer.score === null
            ? <span className="score">No valid answer</span>
            : (
              <>
                <span className="score">{String(answer.score)}</span>{" "}
                <span className="small">raw score · threshold {t}</span>
              </>
            )}
        </dd>
        <dt>Outcome</dt>
        <dd className={`outcome ${answer.outcome}`}>{outcome}</dd>
      </dl>
      <p className="mono">EXACT QUESTION SENT</p>
      <pre className="question">{answer.instructions}</pre>
    </>
  );
}
