/**
 * galleryDb.ts — IndexedDB wrapper for gallery image storage
 *
 * IndexedDB supports large binary data (no ~5MB localStorage limit).
 * We store full GalleryImage objects (including base64 url) in IDB.
 * localStorage is NOT used for images anymore.
 */

const DB_NAME = "geovera_gallery_db";
const DB_VERSION = 1;
const STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export interface GalleryImageRecord {
  id: string;
  themeId: number;
  themeName: string;
  filename: string;
  url: string; // data:image/png;base64,...
  width: number;
  height: number;
  createdAt: string;
  model?: string;
  generationTime?: number;
}

/** Save multiple images to IndexedDB (upsert by id). */
export async function dbSaveImages(images: GalleryImageRecord[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const img of images) {
      store.put(img);
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Load all images from IndexedDB, sorted newest first. */
export async function dbLoadImages(): Promise<GalleryImageRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE, "readonly");
    const store  = tx.objectStore(STORE);
    const req    = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as GalleryImageRecord[]);
      // Sort newest first
      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete images by id array. */
export async function dbDeleteImages(ids: string[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Delete all images. */
export async function dbClearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
