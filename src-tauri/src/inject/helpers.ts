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
      // An abort, e.g. when the disk is full, doesn't always come with an error event.
      tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
    });
  };
}

// Functions that may play something else when Deezer calls dzPlayer.play():
// each gets the options and returns those to play instead, or null.
type PlayReplacer = (options: DeezerPlayOptions) => DeezerPlayOptions | null | Promise<DeezerPlayOptions | null>;
const playReplacers: PlayReplacer[] = [];

// Adds a PlayReplacer. The first one wraps dzPlayer.play, also of players
// Deezer creates later.
function replacePlayOptions(replacer: PlayReplacer) {
  playReplacers.push(replacer);
  if (playReplacers.length > 1) return;
  let dzPlayer = window.dzPlayer;
  Object.defineProperty(window, "dzPlayer", {
    configurable: true,
    get: () => dzPlayer,
    set(player: DeezerPlayer | undefined) {
      dzPlayer = player;
      const play = player?.play;
      if (!player || typeof play !== "function" || play.dazzlerWrapped) return;
      player.play = async function (this: DeezerPlayer, ...args: Parameters<DeezerPlayer["play"]>) {
        const [options] = args;
        for (const replace of playReplacers) {
          const other = options && (await Promise.resolve(replace(options)).catch(() => null));
          if (other) return play.call(this, other);
        }
        return play.apply(this, args);
      };
      player.play.dazzlerWrapped = true;
    },
  });
}

// A request to Deezer's gateway API, with the session's API token, which is
// fetched once and again when it has expired. Resolves with the results, or null.
const deezerApi = (() => {
  let token: Promise<string | null> | null = null;

  async function call(method: string, apiToken: string, body: object) {
    const params = new URLSearchParams({ method, input: "3", api_version: "1.0", api_token: apiToken });
    params.set("cid", String(Math.floor(Math.random() * 1e9)));
    const res = await fetch(`/ajax/gw-light.php?${params}`, {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(body),
    });
    return (await res.json()) as { results?: any; error?: unknown };
  }

  return async function <T>(method: string, body: object): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      token ??= call("deezer.getUserData", "", {}).then((json) => json.results?.checkForm ?? null);
      const apiToken = await token.catch(() => null);
      if (!apiToken) break;
      const json = await call(method, apiToken, body);
      const failed = json.error && Object.keys(json.error).length > 0;
      if (!failed) return json.results ?? null;
      token = null;
    }
    token = null;
    return null;
  };
})();
