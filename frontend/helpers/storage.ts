import { cacheClear } from "./cache.ts";
import { migrateStream, validLegacyRules } from "../../shared/migration.ts";
import {
  validateDocument,
  type WritingDocument,
} from "../../shared/variants.ts";

export const API_KEY_STORAGE = "surprisal-jev-key";
export const INTRO_STORAGE = "surprisal-intro";
const DATABASE = "surprisal";
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("writing");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(
        new Error("Close other Surprisal tabs to finish opening storage."),
      );
    };
  });
}

export function readLegacyWriting(): {
  text: string;
  recovered: string;
} {
  const raw = localStorage.getItem("surprisal-rules");
  let saved: unknown = null;
  // Malformed legacy rules must not prevent recovery of the draft.
  try {
    saved = JSON.parse(raw || "null");
  } catch {
    saved = null;
  }
  const text = localStorage.getItem("surprisal-stream-v1") ??
    migrateStream(
      localStorage.getItem("surprisal-draft"),
      validLegacyRules(saved) ? saved : null,
    );
  let workshop: { passage?: string; revision?: string } | null = null;
  try {
    workshop = JSON.parse(localStorage.getItem("surprisal-workshop") || "null");
  } catch {
    workshop = null;
  }
  const recovered = [
    ...new Set(
      [
        localStorage.getItem("surprisal-original"),
        workshop?.passage,
        workshop?.revision,
      ].filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ].join("\n\n—\n\n");
  return { text, recovered };
}

export async function loadWriting(): Promise<
  string | WritingDocument | undefined
> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const store = db.transaction("writing").objectStore("writing");
    const request = store.get("document-v2");
    request.onsuccess = () => {
      if (request.result !== undefined) {
        try {
          resolve(validateDocument(request.result));
        } catch (error) {
          reject(error);
        }
      } else {
        const legacy = store.get("stream");
        legacy.onsuccess = () => {
          if (
            legacy.result !== undefined && typeof legacy.result !== "string"
          ) {
            reject(new Error("Invalid saved writing"));
          } else resolve(legacy.result);
        };
        legacy.onerror = () => reject(legacy.error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/** Erases saved writing, legacy copies, and model results that quote it. Keys and preferences stay. */
export async function clearWriting(): Promise<void> {
  await cacheClear();
  for (
    const key of [
      "surprisal-stream-v1",
      "surprisal-draft",
      "surprisal-rules",
      "surprisal-workshop",
      "surprisal-original",
      // A reset page is a new page: show the introduction again.
      INTRO_STORAGE,
    ]
  ) localStorage.removeItem(key);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("writing", "readwrite");
    transaction.objectStore("writing").clear();
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveWriting(document: WritingDocument): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("writing", "readwrite");
    // Preserve the legacy stream; structure and inactive choices commit atomically.
    transaction.objectStore("writing").put(document, "document-v2");
    // Request success is not commit success. Report saved only after completion.
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function downloadWriting(text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "surprisal.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDocument(writing: WritingDocument): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(writing, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "surprisal-variants.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
