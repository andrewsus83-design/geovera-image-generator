/**
 * charactersDb.ts — IndexedDB store for trained characters / LoRA records
 *
 * Stores one record per trained LoRA (actor or prop), including:
 *   - Preview images (base64 or Cloudinary URL)
 *   - LoRA metadata (name, type, steps, training time)
 *   - Cloudinary URL for .safetensors download
 *
 * Used by:
 *   - Training page: saves record after training completes
 *   - Characters page: displays all trained characters
 */

const DB_NAME    = "geovera_characters_db";
const DB_VERSION = 1;
const STORE      = "characters";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export interface CharacterRecord {
  id:           string;         // unique id (e.g. `lora_${Date.now()}`)
  name:         string;         // character/product name (productName from training)
  type:         "actor" | "prop"; // training type
  loraName:     string;         // .safetensors filename (e.g. "rio_actor_lora.safetensors")
  loraUrl:      string | null;  // Cloudinary URL for .safetensors (download link)
  previewImages: string[];      // base64 or Cloudinary URLs of training images (up to 6)
  steps:        number;         // training steps completed
  trainingTime: number;         // seconds
  createdAt:    string;         // ISO timestamp
  notes?:       string;         // optional user notes
}

/** Save a new character record to IndexedDB (upsert by id). */
export async function dbSaveCharacter(character: CharacterRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(character);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Load all characters from IndexedDB, sorted newest first. */
export async function dbLoadCharacters(): Promise<CharacterRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req   = store.getAll();
    req.onsuccess = () => {
      const all = req.result as CharacterRecord[];
      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete a character by id. */
export async function dbDeleteCharacter(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Update notes for a character. */
export async function dbUpdateCharacterNotes(id: string, notes: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req   = store.get(id);
    req.onsuccess = () => {
      const rec = req.result as CharacterRecord | undefined;
      if (rec) {
        rec.notes = notes;
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
