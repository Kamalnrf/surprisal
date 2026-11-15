import React, {
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { autopilot, phrases, temperatures } from "../../../shared/surprisal.ts";
import { readSurprisal } from "../../helpers/surprisal.ts";
import { API_KEY_STORAGE, INTRO_STORAGE } from "../../helpers/storage.ts";

const SAMPLE =
  "The rain fell softly on the roof as she sat by the window, lost in thought.";

interface Reading {
  heat: [number, number, number][];
  phrases: [number, number, string][];
  level?: string;
}

// The sample's reading, so step 2 shows marks at once even while the model wakes.
const SAMPLE_READING: Reading = {
  heat: [[40, 43, 0.41], [51, 57, 0.87], [67, 74, 0.76]],
  phrases: [[44, 57, "stock"], [59, 74, "stock"]],
  level: "expected",
};

const LEVELS: Record<string, string> = {
  expected: "the model saw most of it coming",
  "half-expected": "some of it surprised the model",
  unexpected: "the model could not have written this",
};

/** The sample sentence, editable, with the model's marks drawn beneath it. */
function TryIt() {
  const [text, setText] = useState(SAMPLE);
  const [reading, setReading] = useState<Reading | null>(SAMPLE_READING);
  const [error, setError] = useState("");
  const readings = useRef(new Map([[SAMPLE, SAMPLE_READING]]));
  useEffect(() => {
    const saved = readings.current.get(text);
    setReading(saved ?? null);
    if (saved || !text.trim()) return;
    const controller = new AbortController();
    const pause = setTimeout(async () => {
      try {
        const data = await readSurprisal(text, controller.signal);
        const temperature = temperatures(text, data.tokens)[0];
        const next: Reading = {
          heat: autopilot(text, data.tokens).map((h) => [h.from, h.to, h.p]),
          phrases: phrases(text, data.tokens).map((p) => [
            p.from,
            p.to,
            p.kind,
          ]),
          level: temperature?.level,
        };
        readings.current.set(text, next);
        setError("");
        setReading(next);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Surprisal unavailable.");
        }
      }
    }, 700);
    return () => {
      clearTimeout(pause);
      controller.abort();
    };
  }, [text]);

  // Split the text wherever a mark starts or ends.
  const cuts = new Set([0, text.length]);
  for (
    const [from, to] of [...reading?.heat ?? [], ...reading?.phrases ?? []]
  ) {
    cuts.add(from);
    cuts.add(to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces = points.slice(0, -1).map((from, i) => {
    const to = points[i + 1];
    const heat = reading?.heat.find((h) => h[0] <= from && to <= h[1]);
    const phrase = reading?.phrases.find((p) => p[0] <= from && to <= p[1]);
    return (
      <span
        key={from}
        className={[
          heat && "autopilot",
          phrase && (phrase[2] === "echo" ? "echo-phrase" : "stock-phrase"),
        ].filter(Boolean).join(" ")}
        style={heat
          ? { "--heat": heat[2].toFixed(2) } as React.CSSProperties
          : undefined}
      >
        {text.slice(from, to)}
      </span>
    );
  });

  return (
    <>
      <div className="intro-try">
        <div className="intro-mirror" aria-hidden="true">{pieces}{"\n"}</div>
        <textarea
          aria-label="Sample sentence"
          aria-describedby="intro-verdict"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <p id="intro-verdict" className="intro-verdict" aria-live="polite">
        {error
          ? error
          : !reading
          ? "Reading… the model can take a moment to wake."
          : reading.level
          ? (
            <>
              <strong>{reading.level}</strong>: {LEVELS[reading.level]}
            </>
          )
          : "Write a little more for a verdict."}
      </p>
    </>
  );
}

const STEPS = [
  {
    title: "Write away from the expected",
    body: () => (
      <>
        <blockquote className="intro-quote">
          “The struggle of literature is in fact a struggle to escape from the
          confines of language; it stretches out from the utmost limits of what
          can be said; what stirs literature is the call and attraction of what
          is not in the dictionary.”
          <footer>Italo Calvino, Cybernetics and Ghosts, 1967</footer>
        </blockquote>
        <p>
          Language models write the most likely next word. Surprisal shows where
          your writing is most predictable for an LLM, and never writes for you.
          It is deeply inspired by the writing machine in Calvino’s Cybernetics
          and Ghosts. When you know the rules, regulations and expectations
          you’re meeting, you can think to write differently.
        </p>
      </>
    ),
  },
  {
    title: "See where you’re on autopilot",
    body: () => (
      <>
        <p>
          In this heatmap, warm words are ones the model would have written
          itself. Underlines are phrases it would write exactly. Try rewriting
          the sentence.
        </p>
        <TryIt />
      </>
    ),
  },
  {
    title: "Add your own rules",
    body: () => (
      <>
        <p>
          Write rules as plain sentences, anywhere on the page. We pass each
          paragraph to Jev and leave observations when rules are broken. With
          his writing machine, Calvino argues this helps us see the rules and
          understand them more clearly, so we can break them.
        </p>
        <pre className="intro-code">@rules - Flag filler words that add no meaning.</pre>
        <p className="intro-muted">
          Rules need a Jev key. Surprisal works without one.
        </p>
      </>
    ),
  },
  {
    title: "One page, like the Canon Cat",
    body: () => (
      <>
        <img
          className="intro-art"
          src="/intro.webp"
          alt="A Canon Cat computer with one long sheet of writing unrolling from its screen."
          width={800}
          height={393}
        />
        <p>
          Jef Raskin’s Canon Cat and iA Writer are our inspirations for the
          editor. Your writing and rules are all on one page; create your own
          sections and make it yours. Start a new section with ⌘Enter, or +
          Section on touch, and leap with either Option key.
        </p>
      </>
    ),
  },
  {
    title: "Add a Jev key (optional)",
    body: (key: string, setKey: (k: string) => void) => (
      <>
        <p>
          Only rules need it. It’s stored in this browser, unencrypted, and you
          can change it later in Writing settings.
        </p>
        <label className="intro-label" htmlFor="intro-key">Jev API key</label>
        <input
          id="intro-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </>
    ),
  },
];

export default function Onboarding(
  { open, onClose, onKey }: {
    open: boolean;
    onClose: () => void;
    onKey: (key: string) => void;
  },
) {
  const [step, setStep] = useState(0);
  const [key, setKey] = useState("");
  const last = step === STEPS.length - 1;
  const next = useRef<HTMLButtonElement>(null);
  // Back disappears on the first step; keep focus in the dialog.
  useEffect(() => {
    if (
      open && !next.current?.closest(".intro")?.contains(document.activeElement)
    ) {
      next.current?.focus({ preventScroll: true });
    }
  }, [step]);

  function finish() {
    try {
      localStorage.setItem(INTRO_STORAGE, "seen");
      if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim());
    } catch {
      // Unsaved, it shows again next time; the key still works in this tab.
    }
    if (key.trim()) onKey(key.trim());
    setStep(0);
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && finish()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="debug-backdrop intro-backdrop" />
        <Dialog.Popup className="intro" initialFocus={next}>
          <div
            className="intro-progress"
            role="img"
            aria-label={`Step ${step + 1} of ${STEPS.length}`}
          >
            {STEPS.map((_, i) => <i key={i} data-on={i <= step} />)}
          </div>
          <Dialog.Title className="intro-title">
            {STEPS[step].title}
          </Dialog.Title>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              last ? finish() : setStep(step + 1);
            }}
          >
            <div className="intro-body" key={step}>
              {STEPS[step].body(key, setKey)}
            </div>
            <div className="intro-actions">
              {step > 0 && (
                <Button
                  type="button"
                  className="link"
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
              )}
              <span className="intro-spacer" />
              {!last && (
                <Button type="button" className="link" onClick={finish}>
                  Skip intro
                </Button>
              )}
              <Button ref={next} type="submit" className="intro-next">
                {last ? "Start writing" : "Continue"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
