// IndexedDB command and recovery journal for BOMwiki CAD Studio.

const DB_NAME = 'bomwiki-cad-studio';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const SNAPSHOTS = 'snapshots';
const META = 'meta';
const ACTIVE_PROJECT = 'activeProjectId';
const MAX_SNAPSHOTS = 20;

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB request failed.')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted.')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed.')), { once: true });
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        const snapshots = db.createObjectStore(SNAPSHOTS, { keyPath: 'snapshotId' });
        snapshots.createIndex('byUpdatedAt', 'updatedAt');
        snapshots.createIndex('byProject', 'projectId');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB is unavailable.')), { once: true });
    request.addEventListener('blocked', () => reject(new Error('IndexedDB upgrade is blocked by another tab.')), { once: true });
  });
}

const clone = (value) => structuredClone(value);

export async function openStudioJournal() {
  const db = await openDatabase();
  let writeChain = Promise.resolve();

  async function loadActive() {
    const transaction = db.transaction([META, PROJECTS], 'readonly');
    const done = transactionDone(transaction);
    const meta = await requestValue(transaction.objectStore(META).get(ACTIVE_PROJECT));
    const project = meta?.value
      ? await requestValue(transaction.objectStore(PROJECTS).get(meta.value))
      : null;
    await done;
    return project ? clone(project) : null;
  }

  async function loadProject(projectId) {
    await writeChain;
    const transaction = db.transaction(PROJECTS, 'readonly');
    const done = transactionDone(transaction);
    const project = await requestValue(transaction.objectStore(PROJECTS).get(projectId));
    await done;
    return project ? clone(project) : null;
  }

  function queueWrite(work) {
    writeChain = writeChain.then(work, work);
    return writeChain;
  }

  function persistState(state, snapshot = null) {
    const record = clone({ ...state, updatedAt: new Date().toISOString() });
    return queueWrite(async () => {
      const transaction = db.transaction([META, PROJECTS, SNAPSHOTS], 'readwrite');
      transaction.objectStore(PROJECTS).put(record);
      transaction.objectStore(META).put({ key: ACTIVE_PROJECT, value: record.projectId });
      if (snapshot) {
        transaction.objectStore(SNAPSHOTS).put({
          snapshotId: snapshot.snapshotId,
          projectId: record.projectId,
          title: record.title,
          label: snapshot.label,
          featureCount: record.document?.features?.length || 0,
          document: clone(record.document),
          updatedAt: record.updatedAt,
        });
      }
      await transactionDone(transaction);
      if (snapshot) await pruneSnapshots();
    });
  }

  async function pruneSnapshots() {
    const transaction = db.transaction(SNAPSHOTS, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(SNAPSHOTS);
    const all = await requestValue(store.getAll());
    all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const stale of all.slice(MAX_SNAPSHOTS)) store.delete(stale.snapshotId);
    await done;
  }

  async function listRecovery() {
    await writeChain;
    const transaction = db.transaction(SNAPSHOTS, 'readonly');
    const done = transactionDone(transaction);
    const all = await requestValue(transaction.objectStore(SNAPSHOTS).getAll());
    await done;
    return all
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(clone);
  }

  async function clearForTests() {
    await writeChain;
    const transaction = db.transaction([META, PROJECTS, SNAPSHOTS], 'readwrite');
    transaction.objectStore(META).clear();
    transaction.objectStore(PROJECTS).clear();
    transaction.objectStore(SNAPSHOTS).clear();
    await transactionDone(transaction);
  }

  return {
    loadActive,
    loadProject,
    persistState,
    listRecovery,
    clearForTests,
    flush: () => writeChain,
    close: () => db.close(),
  };
}
