export interface TranslationCache {
  /** One string per source cue; '' marks a cue that is not translated yet. */
  get(key: string): Promise<string[] | null>;
  put(key: string, translations: string[]): Promise<void>;
}

const DB_NAME = 'double-sub-translations';
const STORE = 'entries';
/** An episode is about 60 KB, so this is a few megabytes at most. */
export const MAX_ENTRIES = 200;

interface Entry {
  key: string;
  translations: string[];
  updatedAt: number;
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/**
 * IndexedDB of the extension's own origin (offscreen document or service worker), not of the web
 * page: the page's scripts cannot read what the user watched.
 */
export function openTranslationCache(
  factory: IDBFactory = indexedDB,
  now: () => number = Date.now,
): TranslationCache {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  return {
    async get(key) {
      const db = await open();
      try {
        const entry = (await request(db.transaction(STORE).objectStore(STORE).get(key))) as
          Entry | undefined;
        return entry?.translations ?? null;
      } finally {
        db.close();
      }
    },

    async put(key, translations) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put({ key, translations, updatedAt: now() } satisfies Entry);

        // Forget the least recently written entries beyond the limit.
        const count = await request(store.count());
        if (count > MAX_ENTRIES) {
          let excess = count - MAX_ENTRIES;
          const cursorReq = store.index('updatedAt').openKeyCursor();
          await new Promise<void>((resolve, reject) => {
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor || excess <= 0) return resolve();
              store.delete(cursor.primaryKey);
              excess--;
              cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
          });
        }
        await done(tx);
      } finally {
        db.close();
      }
    },
  };
}
