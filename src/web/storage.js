// Board persistence for the web build: IndexedDB, not files.
//
// The desktop keeps each board as a JSON file under Electron's userData folder
// and records the "last open" pointer in a separate file. IndexedDB is the
// browser's equivalent: a `boards` store holds one record per board (the full
// JSON document), and a `meta` store holds small scalars such as the last-open
// pointer. The resume() semantics mirror main.js exactly so the renderer never
// notices which backend it is talking to.

const DB_NAME = 'gazboard-web';
const DB_VERSION = 1;
const BOARDS = 'boards';
const META = 'meta';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOARDS)) db.createObjectStore(BOARDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

const readAll = (store) => new Promise((resolve, reject) => {
  const req = store.getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const readOne = (store, key) => new Promise((resolve, reject) => {
  const req = store.get(key);
  req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
  req.onerror = () => reject(req.error);
});

const put = (store, value, key) => new Promise((resolve, reject) => {
  const req = key === undefined ? store.put(value) : store.put(value, key);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const del = (store, key) => new Promise((resolve, reject) => {
  const req = store.delete(key);
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
});

export async function saveBoard(doc) {
  const db = await openDB();
  const record = {
    id: doc.id,
    name: doc.name || 'Untitled board',
    modified: Date.now(),
    objects: (doc.objects || []).length,
    thumb: null,
    doc
  };
  await put(tx(db, BOARDS, 'readwrite'), record);
  await setLast(doc.id);
  return true;
}

export async function listBoards() {
  const db = await openDB();
  const all = await readAll(tx(db, BOARDS, 'readonly'));
  return all
    .map((b) => ({ id: b.id, name: b.name, modified: b.modified, objects: b.objects, thumb: b.thumb }))
    .sort((a, b) => b.modified - a.modified);
}

export async function loadBoard(id) {
  const db = await openDB();
  const rec = await readOne(tx(db, BOARDS, 'readonly'), id);
  return rec ? rec.doc : null;
}

export async function removeBoard(id) {
  const db = await openDB();
  await del(tx(db, BOARDS, 'readwrite'), id);
  // keep the pointer meaningful: if it pointed at the deleted board, forget it
  const last = await getLast();
  if (last === id) await setLast(null);
  return true;
}

export async function getLast() {
  const db = await openDB();
  const v = await readOne(tx(db, META, 'readonly'), 'last');
  return v || null;
}

export async function setLast(id) {
  const db = await openDB();
  await put(tx(db, META, 'readwrite'), id === null ? null : id, 'last');
  return id;
}

/**
 * The board to open on launch, mirroring the Electron main process:
 * 1. the one that was last open (the pointer),
 * 2. else the most recently touched board that has anything on it,
 * 3. else the most recently touched board, even if empty,
 * 4. else nothing at all.
 */
export async function resumeBoard() {
  const all = await listBoards();
  if (!all.length) return { board: null, reason: 'none' };

  const wanted = await getLast();
  if (wanted) {
    const doc = await loadBoard(wanted);
    if (doc) return { board: doc, reason: 'pointer' };
  }

  for (const b of all) {
    const doc = await loadBoard(b.id);
    if (doc && (doc.objects || []).length) return { board: doc, reason: 'newest' };
  }
  for (const b of all) {
    const doc = await loadBoard(b.id);
    if (doc) return { board: doc, reason: 'empty' };
  }
  return { board: null, reason: 'none' };
}

export async function clearForTest() {
  const db = await openDB();
  const clear = (store) => new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  await clear(tx(db, BOARDS, 'readwrite'));
  await clear(tx(db, META, 'readwrite'));
}