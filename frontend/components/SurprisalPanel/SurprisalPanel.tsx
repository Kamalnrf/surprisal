import React from "react";
import { Button } from "@base-ui/react/button";
import type { SurprisalRun } from "../../hooks/use-surprisal.ts";
import { odds, type Temperature } from "../../../shared/surprisal.ts";

interface Props {
  run?: SurprisalRun;
  // Why surprisal is not reading this paragraph, if it is not.
  message: string;
  autopilotWords: number;
  phrases: number;
  // Phrases the model predicted only because the writer used them already.
  echoes: number;
  // The focused paragraph's sentences, in document positions.
  sentences: Temperature[];
  selectSentence: (from: number, to: number) => void;
  retry: () => void;
  // The inspected word's guesses, when variants are off.
  children?: React.ReactNode;
}

export default function SurprisalPanel(
  {
    run,
    message,
    autopilotWords,
    phrases,
    echoes,
    sentences,
    selectSentence,
    retry,
    children,
  }: Props,
) {
  let body: React.ReactNode;
  if (message) body = <p className="empty">{message}</p>;
  else if (run?.status === "failed") {
    body = (
      <div className="empty">
        <p>{run.error}</p>
        <Button type="button" className="link" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  } else if (run?.status !== "current") {
    body = (
      <p className="empty">
        {run?.status === "reading"
          ? "Reading… the model can take a minute to wake."
          : "Pause, and words on autopilot will warm up."}
      </p>
    );
  } else {
    const counts = [
      autopilotWords &&
      `${autopilotWords} ${autopilotWords === 1 ? "word" : "words"}`,
      phrases && `${phrases} stock ${phrases === 1 ? "phrase" : "phrases"}`,
    ].filter(Boolean);
    body = (
      <>
        <p className="surprisal-count small">
          {counts.length
            ? `${
              counts.join(" and ")
            } in this paragraph the model would have written. Click a word to see what it expected.`
            : "Nothing here the model would have written for you."}
          {echoes > 0 &&
            ` ${
              echoes === 1 ? "One phrase echoes" : `${echoes} phrases echo`
            } your own earlier words.`}
        </p>
        {sentences.length > 0 && (
          <ol
            className="temperature-list"
            aria-label="Sentences by predictability"
          >
            {sentences.map((s) => (
              <li key={s.from}>
                <Button
                  type="button"
                  className="temperature"
                  data-level={s.level}
                  title={`On average the model guessed each word here at about 1 in ${
                    odds(s.bits)
                  }. Click to rewrite it as a variant.`}
                  onClick={() => selectSentence(s.from, s.to)}
                >
                  <span className="temperature-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${
                          Math.round(
                            Math.max(0.08, Math.min(1, (8 - s.bits) / 6)) * 100,
                          )
                        }%`,
                      }}
                    />
                  </span>
                  <span className="temperature-text">{s.text}</span>
                  <span className="small">
                    {s.level}
                    {/* Touch screens have no hover, so the odds show here. */}
                    <span className="odds">1 in {odds(s.bits)}</span>
                  </span>
                </Button>
              </li>
            ))}
          </ol>
        )}
      </>
    );
  }
  return (
    <section className="surprisal" aria-label="Surprisal">
      <div className="panel-head">
        <h2>Surprisal</h2>
      </div>
      {body}
      {children}
    </section>
  );
}
