/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React from "https://esm.sh/react@19.3.0";
import { AUTOPILOT_P, type WordReading } from "../../../shared/surprisal.ts";

/** What the model expected where the writer put `word`. */
export default function WordGuesses(
  { word, reading }: { word: string; reading?: WordReading | null },
) {
  const percent = (p: number) => p >= 0.01 ? `${Math.round(p * 100)}%` : "<1%";
  return (
    <section className="word-guesses" aria-label={`Model guesses for ${word}`}>
      <span className="mono">THE MODEL HERE</span>
      {!reading ? <p className="small">Reading “{word}”…</p> : (
        <>
          <p className="word-verdict">
            {reading.rank === 1 && reading.p >= AUTOPILOT_P
              ? `“${word}” was its first guess (${percent(reading.p)}).`
              : reading.rank === 1
              ? `“${word}” was its first guess, but only ${percent(reading.p)}.`
              : `“${word}” is yours: it ranked it #${reading.rank}.`}
          </p>
          <ol className="guess-list">
            {reading.guesses.map((guess) => (
              <li
                key={guess.text}
                data-yours={guess.text.toLowerCase() ===
                  word.toLowerCase()}
              >
                <span>{guess.text}</span>
                <span className="small">{percent(guess.p)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
