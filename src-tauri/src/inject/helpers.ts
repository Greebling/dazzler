// Helpers shared by the other scripts in this directory.

function onReady(callback: () => void) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback);
  } else {
    callback();
  }
}

function addStyle(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  onReady(() => document.head.append(style));
}

// An object store in an IndexedDB database of its own, as a function that
// runs a request on it in a transaction and resolves with its result.
function openObjectStore(dbName: string, storeName: string) {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await db).transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    return new Promise<T>((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
}
