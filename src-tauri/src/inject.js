// Injected into deezer.com before the page's own scripts run.
(() => {
  if (window.__deezerClient || window.top !== window) return;

  // Capture the Media Session handlers Deezer registers, as a fallback for
  // when its player API isn't available.
  const handlers = {};
  const ms = navigator.mediaSession;
  if (ms && ms.setActionHandler) {
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, handler) => {
      handlers[action] = handler;
      return original(action, handler);
    };
  }

  const clickFirst = (...selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        el.click();
        return;
      }
    }
  };

  const fallbackButtons = {
    playpause: ['[data-testid="play_button_pause"]', '[data-testid="play_button_play"]'],
    play: ['[data-testid="play_button_play"]'],
    pause: ['[data-testid="play_button_pause"]'],
    nexttrack: ['[data-testid="next_track_button"]'],
    previoustrack: ['[data-testid="previous_track_button"]'],
  };

  // Deezer's player controls (window.playerProxy.control).
  const controlMethods = {
    playpause: "togglePause",
    play: "play",
    pause: "pause",
    nexttrack: "nextSong",
    previoustrack: "prevSong",
  };

  // Deezer fetches page content (page.get) fresh on every visit, which takes
  // up to a second. Serve the last response at once and refresh it in the
  // background, so returning to e.g. the home page is instant.
  (() => {
    const MAX_AGE_MS = 15 * 60 * 1000;
    const cache = new Map();
    const originalFetch = window.fetch;

    // Per-request (cid) and per-session (api_token) parameters don't change the content.
    const cacheKey = (url) => {
      if (typeof url !== "string" || !url.includes("method=page.get")) return null;
      const u = new URL(url, location.href);
      u.searchParams.delete("cid");
      u.searchParams.delete("api_token");
      return u.toString();
    };

    const load = (key, args) => {
      const response = originalFetch.apply(window, args);
      response
        .then((res) => (res.ok ? res.clone().text() : null))
        .then((body) => {
          if (body && !hasError(body)) cache.set(key, { body, time: Date.now() });
        })
        .catch(() => {});
      return response;
    };

    const hasError = (body) => {
      try {
        const error = JSON.parse(body).error;
        return error && Object.keys(error).length > 0;
      } catch {
        return true;
      }
    };

    window.fetch = function (input, init) {
      const key = cacheKey(input);
      if (!key || (init?.method && init.method !== "GET")) {
        return originalFetch.apply(this, arguments);
      }
      const cached = cache.get(key);
      const refresh = load(key, arguments);
      if (!cached || Date.now() - cached.time > MAX_AGE_MS) return refresh;
      refresh.catch(() => {});
      return Promise.resolve(
        new Response(cached.body, { headers: { "Content-Type": "application/json" } }),
      );
    };
  })();

  // Deezer's web player always starts with a default playlist, so the queue,
  // track and position are saved here and restored on startup.
  const resume = (() => {
    const DB_NAME = "deezer-client";
    const STORE = "resume";
    const SAVE_INTERVAL_MS = 3000;
    let restored = false;
    let savedSignature = null;

    const db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const request = async (mode, run) => {
      const tx = (await db).transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
    };

    const player = () => {
      const p = window.dzPlayer;
      return p && p.getTrackList && p.getTrackList().length > 0 ? p : null;
    };

    const save = async () => {
      const p = player();
      if (!restored || !p || p.getTrackListType() === "livestream") return;
      const data = p.getTrackList();
      const signature = data.map((t) => t.UID ?? t.SNG_ID).join(",");
      const position = { signature, index: p.getIndexSong(), offset: p.getPosition() };
      await request("readwrite", (store) => {
        // The queue can be large, so it is only rewritten when it changes.
        if (signature !== savedSignature) {
          store.put({ data, context: p.getContext(), type: p.getTrackListType() }, "queue");
        }
        return store.put(position, "position");
      });
      savedSignature = signature;
    };

    const restore = async () => {
      const p = player();
      const [queue, position] = await Promise.all([
        request("readonly", (store) => store.get("queue")),
        request("readonly", (store) => store.get("position")),
      ]);
      if (!queue || !position || p.isPlaying()) return;
      savedSignature = position.signature;
      await p.play({
        data: queue.data,
        index: position.index,
        offset: position.offset,
        autoplay: false,
        context: queue.context,
        type: queue.type,
        id: queue.context?.ID,
        radio: false,
      });
    };

    // Waits for the player to load its default playlist before replacing it.
    const start = () => {
      if (!player()) {
        setTimeout(start, 500);
        return;
      }
      restore()
        .catch((err) => console.error("deezer-client: restore failed", err))
        .finally(() => {
          restored = true;
          setInterval(() => save().catch(() => {}), SAVE_INTERVAL_MS);
        });
    };
    start();

    return { save };
  })();

  window.__deezerClient = {
    media(action) {
      const control = window.playerProxy?.control;
      const method = control?.[controlMethods[action]];
      if (method) {
        method.call(control);
        return;
      }
      const handler = action !== "playpause" && handlers[action];
      if (handler) {
        handler({ action });
      } else {
        clickFirst(...fallbackButtons[action]);
      }
    },

    // Called by the app before it exits.
    beforeClose() {
      window.playerProxy?.control?.pause();
      resume.save().catch(() => {});
    },
  };
})();
