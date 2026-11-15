// Model results kept across reloads. A separate database from writing, so a
// cache failure can never block saving, and the writing schema stays untouched.
const DATABASE = "surprisal-cache";
export type CacheStore = "readings" | "observations";
const STORES: CacheStore[] = ["readings", "observations"];
// Oldest entries are dropped beyond this many per store.
const LIMIT = 1000;

interface Entry<T> {
  key: string;
  value: T;
  at: number;
}

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        request.result.createObjectStore(name, { keyPath: "key" })
          .createIndex("at", "at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

/** The cached value and when it was stored, or undefined. Never throws. */
export async function cacheGet<T>(
  store: CacheStore,
  key: string,
): Promise<{ value: T; at: number } | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => {
        const entry = request.result as Entry<T> | undefined;
        resolve(entry && { value: entry.value, at: entry.at });
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

/** Stores a value; failures only cost a later re-read. */
export async function cacheSet<T>(
  store: CacheStore,
  key: string,
  value: T,
  at = Date.now(),
): Promise<void> {
  try {
    const db = await open();
    const transaction = db.transaction(store, "readwrite");
    const objects = transaction.objectStore(store);
    objects.put({ key, value, at } satisfies Entry<T>);
    const count = objects.count();
    count.onsuccess = () => {
      let extra = count.result - LIMIT;
      if (extra <= 0) return;
      const cursor = objects.index("at").openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result || extra-- <= 0) return;
        cursor.result.delete();
        cursor.result.continue();
      };
    };
    await done(transaction);
  } catch { /* A full or unavailable cache must not affect writing. */ }
}

export async function cacheDelete(store: CacheStore, key: string) {
  try {
    const db = await open();
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).delete(key);
    await done(transaction);
  } catch { /* Nothing to forget. */ }
}

/** Empties every cache; used when all writing is reset. */
export async function cacheClear(): Promise<void> {
  const db = await open();
  const transaction = db.transaction(STORES, "readwrite");
  for (const name of STORES) transaction.objectStore(name).clear();
  await done(transaction);
}
