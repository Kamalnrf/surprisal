import { useEffect, useRef, useState } from "https://esm.sh/react@19.3.0";
import { readSurprisal } from "../helpers/surprisal.ts";
import { cacheGet, cacheSet } from "../helpers/cache.ts";
import type { SurprisalResult } from "../../shared/types.ts";

// Readings from another model or revision must not be reused.
const CACHE_PREFIX = "Qwen3-4B-Base@906bfd:";

export type SurprisalRun =
  | { key: string; status: "waiting" | "reading" }
  | { key: string; status: "current"; data: SurprisalResult }
  | { key: string; status: "failed"; error: string };

/**
 * Reads every passage after a pause, the focused one first, one request at a
 * time. Readings are cached by text, in memory and in IndexedDB, so only
 * paragraphs edited since they were last read cost a request, even after a reload.
 */
export default function useSurprisal(
  texts: string[],
  focus: string | null,
  enabled: boolean,
) {
  const cache = useRef(new Map<string, SurprisalResult>());
  // Bumped whenever the set of available readings may have changed.
  const [version, setVersion] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const missing = [...new Set(focus ? [focus, ...texts] : texts)].filter((t) =>
    !cache.current.has(t)
  );
  const missingKey = missing.join("\0");

  useEffect(() => {
    if (!enabled) return;
    // Undoing back to text that was read already needs no request.
    if (!missing.length) {
      setVersion((v) => v + 1);
      return;
    }
    const controller = new AbortController();
    const pause = new Promise((resolve) => setTimeout(resolve, 900));
    (async () => {
      // Saved readings show at once; only what is left waits for a pause.
      let restored = false;
      for (const text of missing) {
        const saved = await cacheGet<SurprisalResult>(
          "readings",
          CACHE_PREFIX + text,
        );
        if (controller.signal.aborted) return;
        if (saved) {
          remember(text, saved.value);
          restored = true;
        }
      }
      if (restored) setVersion((v) => v + 1);
      await pause;
      for (const text of missing) {
        if (controller.signal.aborted) return;
        if (cache.current.has(text)) continue;
        setReading(text);
        try {
          const data = await readSurprisal(text, controller.signal);
          remember(text, data);
          void cacheSet("readings", CACHE_PREFIX + text, data);
          if (controller.signal.aborted) return;
          setFailure(null);
          setVersion((v) => v + 1);
        } catch (error) {
          if (controller.signal.aborted) return;
          // Stop rather than hammer a scorer that is down or out of allowance.
          setFailure({
            key: text,
            error: error instanceof Error
              ? error.message
              : "Surprisal unavailable",
          });
          break;
        }
      }
      setReading(null);
    })();
    return () => {
      controller.abort();
      setReading(null);
    };
  }, [missingKey, enabled, retry]);

  function remember(text: string, data: SurprisalResult) {
    cache.current.set(text, data);
    if (cache.current.size > 400) {
      cache.current.delete(cache.current.keys().next().value!);
    }
  }
  const read = (text: string) => cache.current.get(text);
  let run: SurprisalRun | undefined;
  if (enabled && focus !== null) {
    const data = read(focus);
    if (data) run = { key: focus, status: "current", data };
    else if (failure) run = { ...failure, status: "failed" };
    else {run = {
        key: focus,
        status: reading === focus ? "reading" : "waiting",
      };}
  }
  return {
    read,
    run,
    version,
    retry: () => {
      setFailure(null);
      setRetry((n) => n + 1);
    },
  };
}
