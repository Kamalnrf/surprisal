import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@19.3.0";
import { AnalysisError, askJev } from "../helpers/jev.ts";
import { cacheDelete, cacheGet, cacheSet } from "../helpers/cache.ts";
import { requestKey } from "../../shared/stream.ts";
import type {
  AnalysisInput,
  AnalysisResult,
  Diagnostics,
} from "../../shared/types.ts";

// Every field belongs to `key`; the hook never returns another key's run.
export type Run =
  & { key: string }
  & (
    | {
      status: "waiting" | "asking";
      data?: never;
      error?: never;
      diagnostics?: never;
      answeredAt?: never;
    }
    | {
      status: "current" | "cached";
      data: AnalysisResult;
      answeredAt: number;
      error?: never;
      diagnostics?: never;
    }
    | {
      status: "failed";
      error: string;
      diagnostics?: Diagnostics;
      answeredAt: number;
      data?: never;
    }
  );

// Answers are reused across reloads for a week; Retry always asks again.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export default function useObservations(
  input: AnalysisInput,
  enabled: boolean,
  apiKey: string,
) {
  const key = requestKey(input);
  const cache = useRef(
    new Map<string, { data: AnalysisResult; time: number }>(),
  );
  const [retry, setRetry] = useState(0);
  // Set by Retry so the next attempt asks Jev instead of reading the saved copy.
  const forget = useRef<string | null>(null);
  // A resumed or retried request is a new attempt, even with identical writing.
  // Matching its identity hides obsolete busy/error state before effects run.
  const attempt = useMemo(() => ({}), [key, enabled, apiKey, retry]);
  const [result, setResult] = useState<{ attempt: object; run: Run } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    const publish = (run: Run) => setResult({ attempt, run });
    const controller = new AbortController();
    const showCached = (cached: { data: AnalysisResult; time: number }) =>
      publish({
        key,
        status: "cached",
        data: cached.data,
        answeredAt: cached.time,
      });
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.time < FRESH_MS) {
      showCached(cached);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const skipSaved = forget.current === key;
    forget.current = null;
    void (skipSaved
      ? Promise.resolve(undefined)
      : cacheGet<AnalysisResult>("observations", key)).then((saved) => {
        if (controller.signal.aborted) return;
        if (saved && Date.now() - saved.at < FRESH_MS) {
          const restored = { data: saved.value, time: saved.at };
          cache.current.set(key, restored);
          showCached(restored);
          return;
        }
        timer = setTimeout(ask, 900);
      });
    async function ask() {
      publish({ key, status: "asking" });
      try {
        const data = await askJev(input, apiKey, controller.signal);
        if (controller.signal.aborted) return;
        const time = Date.now();
        cache.current.set(key, { data, time });
        void cacheSet("observations", key, data, time);
        if (cache.current.size > 60) {
          cache.current.delete(cache.current.keys().next().value!);
        }
        publish({ key, status: "current", data, answeredAt: time });
      } catch (error) {
        if (!controller.signal.aborted) {
          publish({
            key,
            status: "failed",
            error: error instanceof Error
              ? error.message
              : "Observations unavailable",
            diagnostics: error instanceof AnalysisError
              ? error.diagnostics
              : undefined,
            answeredAt: Date.now(),
          });
        }
      }
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);
  const run: Run | undefined = !enabled
    ? undefined
    : result?.attempt === attempt
    ? result.run
    : { key, status: "waiting" };
  return {
    data: run?.data,
    error: run?.error,
    run,
    retry: () => {
      cache.current.delete(key);
      forget.current = key;
      void cacheDelete("observations", key);
      setRetry((value) => value + 1);
    },
  };
}
