import {
  loadWriting,
  readLegacyWriting,
  saveWriting,
} from "../helpers/storage.ts";
import { migrateStream } from "../../shared/migration.ts";
import {
  applyTextEdits,
  documentFromText,
  renderDocument,
  type WritingDocument,
} from "../../shared/variants.ts";

export interface WritingSnapshot {
  readonly status: "loading" | "ready";
  readonly document: WritingDocument;
  readonly text: string;
  readonly recovered: string;
  readonly revision: number;
  readonly committedRevision: number | null;
  readonly storageError: string;
}

export interface EditorEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface WritingStorage {
  load(): Promise<string | WritingDocument | undefined>;
  save(document: WritingDocument): Promise<void>;
  readLegacy(): { text: string; recovered: string };
}

const READ_ERROR =
  "Saved writing could not be read. Copy or download your writing before leaving. Existing saved copies have not been replaced.";
const SAVE_ERROR =
  "Your latest changes could not be saved. Copy or download your writing before leaving.";

export function createWritingStore(storage: WritingStorage) {
  let snapshot: WritingSnapshot = Object.freeze({
    status: "loading",
    document: documentFromText(""),
    text: "",
    recovered: "",
    revision: 0,
    committedRevision: null,
    storageError: "",
  });
  const listeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  let writable = false;
  let saving = false;
  let notifying = false;
  let dispatching = false;
  let editor: { apply: (edit: EditorEdit) => void } | undefined;
  let resetting = false;

  function publish(next: WritingSnapshot) {
    if (
      Object.keys(next).every((key) =>
        next[key as keyof WritingSnapshot] ===
          snapshot[key as keyof WritingSnapshot]
      )
    ) return;
    snapshot = Object.freeze(next);
    notifying = true;
    try {
      for (const listener of [...listeners]) listener();
    } finally {
      notifying = false;
    }
  }

  function requireReady() {
    if (snapshot.status !== "ready") {
      throw new Error("Writing is still loading.");
    }
    if (notifying) {
      throw new Error(
        "Writing commands cannot run from a synchronous subscriber.",
      );
    }
  }

  // Capture both text and revision: a completed older write cannot acknowledge newer edits.
  async function persist() {
    if (
      !writable || saving || snapshot.revision === snapshot.committedRevision
    ) return;
    saving = true;
    const { document, revision } = snapshot;
    try {
      await storage.save(document);
    } catch {
      saving = false;
      publish({ ...snapshot, storageError: SAVE_ERROR });
      // Keep dirty memory, but never spin on a failing database. Edits or retry restart it.
      return;
    }
    saving = false;
    publish({ ...snapshot, committedRevision: revision, storageError: "" });
    void persist();
  }

  function acceptEditorDocument(document: WritingDocument) {
    requireReady();
    if (document === snapshot.document) return;
    publish({
      ...snapshot,
      document,
      text: renderDocument(document),
      revision: snapshot.revision + 1,
    });
    void persist();
  }

  function command(edit: EditorEdit) {
    requireReady();
    if (dispatching) {
      throw new Error("Writing editor commands cannot be reentrant.");
    }
    if (!editor) {
      acceptEditorDocument(applyTextEdits(snapshot.document, [edit]));
      return;
    }
    dispatching = true;
    try {
      editor.apply(edit);
    } finally {
      dispatching = false;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(): Promise<void> {
      return loading ??= (async () => {
        globalThis.addEventListener("beforeunload", (event) => {
          if (
            !resetting && snapshot.status === "ready" &&
            snapshot.revision !== snapshot.committedRevision
          ) {
            event.preventDefault();
            (event as BeforeUnloadEvent).returnValue = "";
          }
        });
        let legacy = { text: migrateStream(null, null), recovered: "" };
        try {
          legacy = storage.readLegacy();
        } catch { /* localStorage may be disabled independently. */ }
        let existing: string | WritingDocument | undefined;
        try {
          existing = await storage.load();
        } catch {
          publish({
            ...snapshot,
            ...legacy,
            document: documentFromText(legacy.text),
            status: "ready",
            storageError: READ_ERROR,
          });
          return;
        }
        writable = true;
        const document = typeof existing === "object"
          ? existing
          : documentFromText(existing ?? legacy.text);
        publish({
          ...snapshot,
          ...legacy,
          document,
          text: renderDocument(document),
          status: "ready",
          committedRevision: typeof existing === "object" ? 0 : null,
        });
        void persist();
      })();
    },
    setText(text: string) {
      requireReady();
      if (text === snapshot.text) return;
      command({ from: 0, to: snapshot.text.length, text });
    },
    append(text: string) {
      requireReady();
      if (!text) return;
      command({ from: snapshot.text.length, to: snapshot.text.length, text });
    },
    acceptEditorDocument,
    connectEditor(applyEdit: (edit: EditorEdit) => void) {
      requireReady();
      const connection = { apply: applyEdit };
      editor = connection;
      return () => {
        if (editor === connection) editor = undefined;
      };
    },
    /** Stops saving, erases storage, and reloads into the starter document. */
    async reset(clear: () => Promise<void>) {
      requireReady();
      writable = false;
      resetting = true;
      while (saving) await new Promise((r) => setTimeout(r, 20));
      await clear();
      location.reload();
    },
    retrySave() {
      requireReady();
      void persist();
    },
  };
}

export const writingStore = createWritingStore({
  load: loadWriting,
  save: saveWriting,
  readLegacy: readLegacyWriting,
});
