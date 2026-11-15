import { useEffect, useSyncExternalStore } from "react";
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
