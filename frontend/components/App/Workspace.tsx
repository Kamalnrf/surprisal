/** @jsxImportSource https://esm.sh/react@19.3.0 */
import React, {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "https://esm.sh/react@19.3.0";
import { Button } from "https://esm.sh/@base-ui/react@1.9.0/button?deps=react@19.3.0,react-dom@19.3.0";
import { Drawer } from "https://esm.sh/@base-ui/react@1.9.0/drawer?deps=react@19.3.0,react-dom@19.3.0";
import Editor, {
  type EditorHandle,
  type EditorSnapshot,
  type Leap,
} from "../Editor/index.ts";
import ObservationsPanel from "../ObservationsPanel/index.ts";
import StatusBar from "../StatusBar/index.ts";
import LeapSearch from "../StatusBar/LeapSearch.tsx";
import WritingSettings from "../StatusBar/WritingSettings.tsx";
import Guide from "../StatusBar/Guide.tsx";
import PredictionsDebug from "../PredictionsDebug/index.ts";
import VariantsPanel from "../VariantsPanel/index.ts";
import SurprisalPanel, { WordGuesses } from "../SurprisalPanel/index.ts";
import useSurprisal from "../../hooks/use-surprisal.ts";
import {
  autopilot,
  type Heat,
  passages,
  phrases,
  readWord,
  temperatures,
} from "../../../shared/surprisal.ts";
import { visibleGroups } from "../../../shared/variants.ts";
import { downloadWriting } from "../../helpers/storage.ts";
import { writingStore } from "../../stores/writing.ts";
import useObservations from "../../hooks/use-observations.ts";
import { analysisPause, STATUS_LABEL } from "../../helpers/analysis.ts";
import {
  ignoredLines,
  markdownBlocks,
  ruleLines,
  rulesFromText,
  sections,
  streamFocus,
} from "../../../shared/stream.ts";

export default function Workspace({
  initialText,
  recovered,
  storageError,
  apiKey,
  changeKey,
  showIntro,
}: {
  initialText: string;
  recovered: string;
  storageError: string;
  apiKey: string;
  changeKey: () => void;
  showIntro: () => void;
}) {
  const editor = useRef<EditorHandle>(null);
  const [sheetHost, setSheetHost] = useState<HTMLDivElement | null>(null);
  // Set just before an explicit selection (a tapped warm word or sentence).
  const askedSelect = useRef(false);
  const focusRequest = useRef<
    { target: "variants" } | { target: "writing"; position: number } | null
  >(null);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    text: initialText,
    document: writingStore.getSnapshot().document,
    head: 0,
    from: 0,
    to: 0,
    composing: false,
    leaping: false,
  });
  const [leap, setLeap] = useState<Leap | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [variantsOn, setVariantsOn] = useState(() => {
    try {
      return localStorage.getItem("otherwise-variants") !== "false";
    } catch {
      return true;
    }
  });
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [activeVariant, setActiveVariant] = useState<string | null>(null);
  const activeRange = visibleGroups(snapshot.document).find((range) =>
    range.groupId === activeVariant
  );
  const variantId = variantsOn && variantsOpen && activeRange
    ? activeRange.groupId
    : null;
  const [mobile, setMobile] = useState(() =>
    matchMedia("(max-width:850px)").matches
  );
  const [panelOpen, setPanelOpen] = useState(!mobile);
  const [analysisOn, setAnalysisOn] = useState(() => {
    try {
      return localStorage.getItem("surprisal-margin") !== "false";
    } catch {
      return true;
    }
  });
  const [surprisalOn, setSurprisalOn] = useState(() => {
    try {
      return localStorage.getItem("surprisal-on") !== "false";
    } catch {
      return true;
    }
  });
  // Typing preferences: smart punctuation is on and typewriter scrolling off
  // unless the writer changes them.
  const [smartOn, setSmartOn] = useState(() => {
    try {
      return localStorage.getItem("surprisal-smart") !== "false";
    } catch {
      return true;
    }
  });
  const [typewriterOn, setTypewriterOn] = useState(() => {
    try {
      return localStorage.getItem("surprisal-typewriter") === "true";
    } catch {
      return false;
    }
  });
  function setPreference(key: string, on: boolean, set: (on: boolean) => void) {
    set(on);
    try {
      localStorage.setItem(key, String(on));
    } catch { /* Preference failure must not stop writing. */ }
  }
  const focus = streamFocus(snapshot.text, snapshot.head);
  const readable = passages(snapshot.text);
  // The focused paragraph's passage, if Surprisal reads it.
  // The read part of the focused paragraph under the cursor; @ignore lines
  // can split a paragraph into several.
  const inFocus = readable.filter((p) =>
    p.start >= focus.start && p.end <= focus.end
  );
  const under = (r: { from: number; to: number }) =>
    r.from <= snapshot.head && snapshot.head <= r.to;
  const ignoredHere = ignoredLines(snapshot.text).some(under);
  const rules = ruleLines(snapshot.text);
  const ruleHere = !ignoredHere && rules.some(under);
  // On code, a table, a divider or an image, or in a paragraph of only those.
  const blocks = markdownBlocks(snapshot.text);
  const blockHere = !ignoredHere && !ruleHere && (blocks.some(under) ||
    !inFocus.length &&
      blocks.some((b) => b.from < focus.end && focus.start < b.to));
  const reading = ignoredHere || ruleHere || blockHere
    ? undefined
    : inFocus.find((p) => p.start <= snapshot.head && snapshot.head <= p.end) ??
      inFocus.findLast((p) => p.start <= snapshot.head) ?? inFocus[0];
  let surprisalPaused = "";
  if (focus.excluded) surprisalPaused = "This section is not read.";
  else if (!focus.text.trim()) {
    surprisalPaused =
      "Write first. Pause, and words on autopilot will warm up.";
  } else if (ignoredHere) {
    surprisalPaused = "This line is marked @ignore and is not read.";
  } else if (ruleHere) {
    surprisalPaused = "This line is a rule and is not read.";
  } else if (blockHere) {
    surprisalPaused = "Code, tables, dividers and images are not read.";
  } else if (!reading) {
    surprisalPaused = "Split this paragraph with a blank line to read it.";
  }
  const surprisal = useSurprisal(
    readable.map((p) => p.text),
    reading?.text ?? null,
    surprisalOn && !snapshot.composing && !snapshot.leaping,
  );
  const surprisalData = surprisal.run?.status === "current"
    ? surprisal.run.data
    : undefined;
  const focusHeat = surprisalData && reading
    ? autopilot(reading.text, surprisalData.tokens, reading.context)
    : [];
  const focusPhrases = surprisalData && reading
    ? phrases(reading.text, surprisalData.tokens, reading.context)
    : [];
  // Sentences of the focused paragraph, in document positions.
  const focusSentences = surprisalData && reading
    ? temperatures(reading.text, surprisalData.tokens, reading.context).map((
      t,
    ) => ({ ...t, from: t.from + reading.offset, to: t.to + reading.offset }))
    : [];
  // Words, phrases and autopilot sentences of every paragraph that has a
  // reading for its current text.
  const allHeat = () =>
    readable.flatMap((p) => {
      const data = surprisal.read(p.text);
      if (!data) return [];
      const marks: Heat[] = [
        ...autopilot(p.text, data.tokens, p.context),
        ...phrases(p.text, data.tokens, p.context).map((x) => ({ ...x, p: 1 })),
        ...temperatures(p.text, data.tokens, p.context)
          .filter((t) => t.level === "expected")
          .map((t) => ({
            from: t.from,
            to: t.to,
            // Odds as a probability, for the hover text.
            p: 2 ** -t.bits,
            kind: "sentence" as const,
          })),
      ];
      return marks.map((h) => ({
        ...h,
        from: h.from + p.offset,
        to: h.to + p.offset,
      }));
    });
  // A single selected word, or a word-sized variant, shows what the model expected there.
  const inspected = activeRange ??
    (snapshot.from !== snapshot.to
      ? { from: snapshot.from, to: snapshot.to }
      : null);
  const inspectedWord = inspected &&
      inspected.from >= focus.start && inspected.to <= focus.end
    ? snapshot.text.slice(inspected.from, inspected.to).trim()
    : "";
  const wordGuesses = surprisalOn && reading &&
    /^[\p{L}\p{N}'’-]+$/u.test(inspectedWord) && (
    <WordGuesses
      word={inspectedWord}
      reading={surprisalData && reading &&
        readWord(
          surprisalData.tokens,
          inspected!.from - reading.offset,
          inspected!.to - reading.offset,
        )}
    />
  );
  const parsed = rulesFromText(snapshot.text);
  // Rule lines are blanked, not removed, so findings keep their offsets.
  let paragraph = focus.text;
  for (const r of rules) {
    if (r.from >= focus.start && r.to <= focus.end) {
      paragraph = paragraph.slice(0, r.from - focus.start) +
        " ".repeat(r.to - r.from) + paragraph.slice(r.to - focus.start);
    }
  }
  const input = {
    paragraph,
    context: focus.context,
    rules: parsed.rules,
  };
  const paused = !apiKey
    ? "Add a Jev key in Writing settings for predictions."
    : ruleHere && !parsed.errors.length
    ? `This line is a rule. ${parsed.rules.length} rules active.`
    : analysisPause(focus, parsed, analysisOn, snapshot);
  const location = focus.section.tag === "@rules"
    ? "Rule section"
    : `Section ${focus.section.index + 1} · Paragraph ${focus.index + 1}`;
  const observations = useObservations(input, !paused, apiKey);
  const analysisStatus = paused ||
    STATUS_LABEL[observations.run?.status ?? "waiting"];

  useEffect(() => {
    const media = matchMedia("(max-width:850px)");
    const change = () => {
      setMobile(media.matches);
      setPanelOpen(!media.matches);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    editor.current?.measure();
  }, [panelOpen]);
  // Keep the last marks while typing; replace them only when readings change.
  useEffect(() => {
    editor.current?.setHeat(surprisalOn ? allHeat() : []);
  }, [surprisalOn, surprisal.version]);
  // Move focus only after the destination is mounted and the old panel is gone.
  useLayoutEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request?.target === "variants") focusVariantText();
    else if (request?.target === "writing") {
      editor.current?.focus(request.position);
    }
  });
  const escape = useEffectEvent((event: KeyboardEvent) => {
    // Overlays handle their own Escape; keep the drawer underneath.
    if (
      debugOpen || menuOpen || event.defaultPrevented || event.isComposing ||
      event.ctrlKey
    ) return;
    if (event.key === "Escape" && variantsOpen && !leap) {
      event.preventDefault();
      closeVariants();
      return;
    }
    if (event.key === "Escape" && panelOpen && mobile && !leap) {
      event.preventDefault();
      closePanel();
    }
  });
  useEffect(() => {
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  function closeVariants() {
    focusRequest.current = {
      target: "writing",
      position: activeRange?.to ?? snapshot.to,
    };
    setVariantsOpen(false);
    setActiveVariant(null);
    if (mobile) setPanelOpen(false);
  }
  function selectVariant(groupId: string) {
    if (variantsOpen && panelOpen && activeVariant === groupId) {
      focusVariantText();
      return;
    }
    focusRequest.current = { target: "variants" };
    setActiveVariant(groupId);
    setVariantsOpen(true);
    setPanelOpen(true);
  }
  function focusVariantText() {
    const field = document.querySelector<HTMLTextAreaElement>(
      ".variants-panel .variant-row[data-active=true] textarea, .variants-panel #variant-add",
    );
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
  }
  function setVariants(on: boolean) {
    setVariantsOn(on);
    if (!on) closeVariants();
    try {
      localStorage.setItem("otherwise-variants", String(on));
    } catch { /* A preference must not stop editing. */ }
  }
  // Opens variants for the selection in `next`; on mobile, scrolls it above the drawer.
  function openSelection(next: EditorSnapshot) {
    const exact = visibleGroups(next.document).find((range) =>
      range.from === next.from && range.to === next.to
    );
    setActiveVariant(exact?.groupId ?? null);
    setVariantsOpen(true);
    setPanelOpen(true);
    if (mobile) requestAnimationFrame(() => editor.current?.reveal());
  }
  function closePanel() {
    closeVariants();
    setPanelOpen(false);
  }
  function setSurprisal(on: boolean) {
    setSurprisalOn(on);
    try {
      localStorage.setItem("surprisal-on", String(on));
    } catch { /* Preference failure must not stop writing. */ }
  }
  const surprisalPanel = surprisalOn && (
    <SurprisalPanel
      run={surprisal.run}
      message={surprisalPaused.trim()}
      autopilotWords={focusHeat.length}
      phrases={focusPhrases.filter((x) => x.kind === "stock").length}
      echoes={focusPhrases.filter((x) => x.kind === "echo").length}
      sentences={focusSentences}
      selectSentence={(from, to) => {
        askedSelect.current = true;
        editor.current?.select(from, to);
      }}
      retry={surprisal.retry}
    >
      {wordGuesses}
    </SurprisalPanel>
  );
  function setAnalysis(on: boolean) {
    setAnalysisOn(on);
    try {
      localStorage.setItem("surprisal-margin", String(on));
    } catch { /* Preference failure must not stop writing. */ }
  }
  const panel = (
    <>
      {variantsOn && variantsOpen
        ? (
          <>
            <VariantsPanel
              key={variantId ?? "selection"}
              document={snapshot.document}
              groupId={variantId}
              selection={!variantId && snapshot.from !== snapshot.to
                ? {
                  from: snapshot.from,
                  to: snapshot.to,
                  text: snapshot.text.slice(snapshot.from, snapshot.to),
                }
                : null}
              editor={editor}
              selectGroup={selectVariant}
              close={closeVariants}
            />
            {wordGuesses}
            <details className="variant-rules">
              <summary>Rules &amp; observations</summary>
              <ObservationsPanel
                data={observations.data}
                focus={focus}
                input={input}
                message={observations.error
                  ? "Analysis unavailable. Inspect predictions below."
                  : paused}
                close={closePanel}
              />
            </details>
          </>
        )
        : (
          <>
            {surprisalPanel}
            <ObservationsPanel
              data={observations.data}
              focus={focus}
              input={input}
              message={observations.error
                ? "Analysis unavailable. Inspect predictions below."
                : paused}
              close={closePanel}
            />
          </>
        )}
    </>
  );
  // The bottom sheet renders inside the workspace, above the bar.
  // The server supplies source metadata; browser code never calls server-only utils.
  const sourceUrl = document.getElementById("root")!.dataset.sourceUrl!;
  // Phones keep these above the writing, since the bar hides while typing;
  // wider screens fold them into the bar.
  const actions = (
    <nav className="writing-actions" aria-label="Writing actions">
      <Button
        type="button"
        aria-label="New section"
        onClick={() => editor.current?.insertBreak()}
      >
        + Section
      </Button>
      <Button
        type="button"
        aria-expanded={!!leap}
        aria-controls="leap-form"
        onClick={() =>
          leap ? editor.current?.closeLeap() : editor.current?.openLeap()}
      >
        Leap
      </Button>
      <Button
        type="button"
        id="show-panel"
        aria-expanded={panelOpen}
        aria-controls="observations"
        onClick={() => {
          setPanelOpen(!panelOpen);
          if (mobile && !panelOpen) {
            requestAnimationFrame(() =>
              document.getElementById("close-panel")?.focus({
                preventScroll: true,
              })
            );
          }
        }}
      >
        Notes{observations.data
          ? ` · ${observations.data.observations.length}`
          : ""}
      </Button>
    </nav>
  );
  return (
    <div
      ref={setSheetHost}
      className={`workspace ${!panelOpen ? "panel-closed" : ""} ${
        mobile && panelOpen ? "drawer-open" : ""
      }`}
    >
      {mobile && actions}
      <main>
        <Editor
          ref={editor}
          onLeap={setLeap}
          variantsOn={variantsOn}
          activeVariant={variantId}
          onVariant={selectVariant}
          onFocusVariants={focusVariantText}
          onWord={() => askedSelect.current = true}
          smartPunctuation={smartOn}
          typewriter={typewriterOn}
          onChange={(next, docChanged, fromSidebar) => {
            const asked = askedSelect.current;
            askedSelect.current = false;
            if (docChanged && !fromSidebar) {
              // The mobile drawer must not cover the line being edited.
              if (mobile) setPanelOpen(false);
            }
            const moved = !fromSidebar && !docChanged && !next.composing &&
              !next.leaping &&
              (next.from !== snapshot.from || next.to !== snapshot.to);
            // On mobile a selection only opens variants when asked: a tapped
            // warm word or sentence, or the Variants chip. Selecting to copy
            // stays native.
            if (
              moved && variantsOn && next.from !== next.to && (!mobile || asked)
            ) openSelection(next);
            // Tapping the writing to place the cursor puts the drawer away.
            if (moved && mobile && next.from === next.to && panelOpen) {
              setVariantsOpen(false);
              setActiveVariant(null);
              setPanelOpen(false);
            }
            setSnapshot(next);
          }}
        />
        {mobile && !panelOpen && variantsOn && snapshot.from !== snapshot.to &&
          !snapshot.leaping && (
          <Button
            type="button"
            className="selection-chip"
            // Open on press: cancelling it keeps the writing's selection,
            // but on touch WebKit then sends no click.
            onPointerDown={(event) => {
              event.preventDefault();
              openSelection(snapshot);
            }}
            onClick={() => openSelection(snapshot)}
          >
            Variants
          </Button>
        )}
        {mobile
          ? (
            // A non-modal bottom sheet: the writing above stays editable,
            // and a swipe down or a tap on the handle closes it.
            <Drawer.Root
              open={panelOpen}
              onOpenChange={(open) => {
                if (!open) closePanel();
              }}
              modal={false}
              disablePointerDismissal
            >
              <Drawer.Portal container={sheetHost}>
                <Drawer.Viewport className="sheet-viewport">
                  <Drawer.Popup
                    id="observations"
                    className="sheet"
                    aria-label="Writing tools"
                    initialFocus={false}
                    finalFocus={false}
                  >
                    <Drawer.Close
                      className="drawer-handle"
                      aria-label="Close panel"
                    />
                    <Drawer.Content className="margin">{panel}</Drawer.Content>
                  </Drawer.Popup>
                </Drawer.Viewport>
              </Drawer.Portal>
            </Drawer.Root>
          )
          : (
            <aside
              id="observations"
              className="margin"
              aria-label="Writing tools"
            >
              {panel}
            </aside>
          )}
      </main>
      <PredictionsDebug
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        location={location}
        input={input}
        run={observations.run}
        paused={paused}
        retry={observations.retry}
      />
      {storageError && (
        <p id="storage-error" role="alert">
          {storageError}{" "}
          <Button
            type="button"
            className="link"
            onClick={() => downloadWriting(snapshot.text)}
          >
            Download writing
          </Button>
          <Button
            type="button"
            className="link"
            onClick={writingStore.retrySave}
          >
            Retry saving
          </Button>
        </p>
      )}
      <StatusBar
        section={focus.section.index + 1}
        count={sections(snapshot.text).length}
        words={focus.section.text.match(/\S+/gu)?.length ?? 0}
        search={leap ? <LeapSearch leap={leap} editor={editor} /> : undefined}
        error={observations.error}
        inspect={() => setDebugOpen(true)}
        actions={mobile ? undefined : actions}
      >
        <WritingSettings
          open={menuOpen}
          onOpenChange={setMenuOpen}
          analysisOn={analysisOn}
          variantsOn={variantsOn}
          onVariantsChange={setVariants}
          onAnalysisChange={setAnalysis}
          surprisalOn={surprisalOn}
          onSurprisalChange={setSurprisal}
          smartOn={smartOn}
          onSmartChange={(on) =>
            setPreference("surprisal-smart", on, setSmartOn)}
          typewriterOn={typewriterOn}
          onTypewriterChange={(on) =>
            setPreference("surprisal-typewriter", on, setTypewriterOn)}
          status={analysisStatus}
          error={observations.error}
          retry={observations.retry}
        >
          <Guide
            text={snapshot.text}
            recovered={recovered}
            ruleErrors={parsed.errors}
            insertGuide={() => setMenuOpen(false)}
            changeKey={changeKey}
            showIntro={() => {
              setMenuOpen(false);
              showIntro();
            }}
            sourceUrl={sourceUrl}
          />
        </WritingSettings>
      </StatusBar>
    </div>
  );
}
