import { useEffect, useSyncExternalStore } from "https://esm.sh/react@19.3.0";
import { writingStore } from "../stores/writing.ts";

export default function useWriting() {
  const snapshot = useSyncExternalStore(
    writingStore.subscribe,
    writingStore.getSnapshot,
  );
  useEffect(() => {
    void writingStore.load();
  }, []);
  return snapshot;
}
