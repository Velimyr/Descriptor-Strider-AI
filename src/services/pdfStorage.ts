import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'archival_strider_db';
const STORE_NAME = 'pdf_files';
const RESULTS_STORE = 'project_results';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(RESULTS_STORE)) {
          db.createObjectStore(RESULTS_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export const pdfStorage = {
  async save(id: string, data: ArrayBuffer): Promise<void> {
    const db = await getDB();
    await db.put(STORE_NAME, data, id);
  },

  async get(id: string): Promise<ArrayBuffer | undefined> {
    const db = await getDB();
    return db.get(STORE_NAME, id);
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
  },

  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear(STORE_NAME);
  },

  // Results storage (to avoid localStorage quota issues)
  async saveResults(projectId: string, results: any[]): Promise<void> {
    const db = await getDB();
    await db.put(RESULTS_STORE, results, projectId);
  },

  async getResults(projectId: string): Promise<any[] | undefined> {
    const db = await getDB();
    return db.get(RESULTS_STORE, projectId);
  },

  async deleteResults(projectId: string): Promise<void> {
    const db = await getDB();
    await db.delete(RESULTS_STORE, projectId);
  }
};
