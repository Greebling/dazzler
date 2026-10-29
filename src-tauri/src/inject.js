// Injected into deezer.com before the page's own scripts run.
(() => {
  if (window.__deezerClient || window.top !== window) return;

  // Deezer's player controls (window.playerProxy.control) per media action.
  const MEDIA_CONTROLS = {
    playpause: "togglePause",
    play: "play",
    pause: "pause",
    nexttrack: "nextSong",
    previoustrack: "prevSong",
  };

  // Player bar buttons, used when the player API isn't available.
  const MEDIA_BUTTONS = {
    playpause: ['[data-testid="play_button_pause"]', '[data-testid="play_button_play"]'],
    play: ['[data-testid="play_button_play"]'],
    pause: ['[data-testid="play_button_pause"]'],
    nexttrack: ['[data-testid="next_track_button"]'],
    previoustrack: ['[data-testid="previous_track_button"]'],
  };

  const mediaSessionHandlers = captureMediaSessionHandlers();
  cachePageContent();
  hideSocialMedia();
  addVolumeSlider();
  const resume = resumePlayback();

  // Called from main.rs.
  window.__deezerClient = {
    // action: "playpause", "play", "pause", "nexttrack" or "previoustrack".
    media(action) {
      runMediaAction(action);
    },

    // Called before the app exits.
    beforeClose() {
      window.playerProxy?.control?.pause();
      resume.save().catch(() => {});
    },
  };

  // --- Helpers ---

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function addStyle(css) {
    const style = document.createElement("style");
    style.textContent = css;
    onReady(() => document.head.append(style));
  }

  // --- Media keys ---

  // Captures the Media Session handlers Deezer registers, as a fallback for
  // when its player API isn't available.
  function captureMediaSessionHandlers() {
    const handlers = {};
    const ms = navigator.mediaSession;
    if (ms?.setActionHandler) {
      const original = ms.setActionHandler.bind(ms);
      ms.setActionHandler = (action, handler) => {
        handlers[action] = handler;
        return original(action, handler);
      };
    }
    return handlers;
  }

  function runMediaAction(action) {
    const control = window.playerProxy?.control;
    const method = control?.[MEDIA_CONTROLS[action]];
    if (method) {
      method.call(control);
      return;
    }
    // Deezer doesn't report its playback state, so a toggle has no handler to pick.
    const handler = action !== "playpause" && mediaSessionHandlers[action];
    if (handler) {
      handler({ action });
      return;
    }
    const button = MEDIA_BUTTONS[action]
      .map((selector) => document.querySelector(selector))
      .find(Boolean);
    button?.click();
  }

  // --- Page cache ---

  // Deezer fetches page content (page.get) fresh on every visit, which takes
  // up to a second. Serves the last response at once and refreshes it in the
  // background, so returning to e.g. the home page is instant.
  function cachePageContent() {
    const MAX_AGE_MS = 15 * 60 * 1000;
    const cache = new Map();
    const originalFetch = window.fetch;

    // Per-request (cid) and per-session (api_token) parameters don't change the content.
    function cacheKey(url) {
      if (typeof url !== "string" || !url.includes("method=page.get")) return null;
      const u = new URL(url, location.href);
      u.searchParams.delete("cid");
      u.searchParams.delete("api_token");
      return u.toString();
    }

    function hasError(body) {
      try {
        const error = JSON.parse(body).error;
        return error && Object.keys(error).length > 0;
      } catch {
        return true;
      }
    }

    function fetchAndCache(key, args) {
      const response = originalFetch.apply(window, args);
      response
        .then((res) => (res.ok ? res.clone().text() : null))
        .then((body) => {
          if (body && !hasError(body)) cache.set(key, { body, time: Date.now() });
        })
        .catch(() => {});
      return response;
    }

    window.fetch = function (input, init) {
      const key = cacheKey(input);
      if (!key || (init?.method && init.method !== "GET")) {
        return originalFetch.apply(this, arguments);
      }
      const cached = cache.get(key);
      const refresh = fetchAndCache(key, arguments);
      if (!cached || Date.now() - cached.time > MAX_AGE_MS) return refresh;
      refresh.catch(() => {});
      return Promise.resolve(
        new Response(cached.body, { headers: { "Content-Type": "application/json" } }),
      );
    };
  }

  // --- Social media ---

  // Hides links and buttons to Facebook, X, Instagram and TikTok (e.g. the
  // social profile links on artist pages). Their domains are also blocked in main.rs.
  function hideSocialMedia() {
    const domains = [
      "facebook.com",
      "fb.com",
      "fb.me",
      "twitter.com",
      "//x.com",
      ".x.com",
      "instagram.com",
      "tiktok.com",
    ];
    const icons = ["Facebook", "Twitter", "XIcon", "Instagram", "Tiktok", "TikTok"];

    const links = domains.map((domain) => `a[href*="${domain}"]`).join(", ");
    const iconSvgs = icons.map((name) => `svg[data-testid^="${name}"]`).join(", ");
    const social = `:is(${links}), :is(a, button):has(${iconSvgs})`;
    addStyle(`${social}, li:has(> :is(${social})) { display: none !important; }`);
  }

  // --- Volume slider ---

  // Replaces the volume button (whose slider only exists while its hover
  // popover is open) with an always visible slider at the start of its button group.
  // It reuses Deezer's own slider classes for the look.
  function addVolumeSlider() {
    const WHEEL_STEP = 5;
    const SYNC_INTERVAL_MS = 500;

    addStyle(`
      [data-testid^="volume_button"] { display: none !important; }
      #deezer-client-volume {
        width: 140px;
        margin: 0 16px 0 0;
        align-self: center;
        padding: 2px 0;
      }
      #deezer-client-volume .slider-track-default {
        background-color: var(--tempo-colors-background-neutral-tertiary-default, #232326);
      }
      #deezer-client-volume .slider-track-active {
        background-color: var(--tempo-colors-background-accent-primary-default, #97b5ff);
      }
    `);

    const slider = document.createElement("div");
    slider.id = "deezer-client-volume";
    slider.className = "slider";
    slider.innerHTML = `
      <div class="slider-track">
        <div class="slider-track-default"></div>
        <div class="slider-track-active"></div>
        <input class="slider-track-input" type="range" min="0" max="100" step="1" aria-label="Volume">
      </div>`;
    const input = slider.querySelector("input");
    const active = slider.querySelector(".slider-track-active");
    let dragging = false;

    function show(value) {
      input.value = value;
      active.style.width = `${value}%`;
    }

    function setVolume(value) {
      value = Math.max(0, Math.min(100, value));
      show(value);
      window.dzPlayer?.control?.setVolume(value / 100, true);
    }

    // Follows volume changes made elsewhere (e.g. muting, other devices).
    function syncFromPlayer() {
      const player = window.dzPlayer;
      if (!player || dragging) return;
      show(player.muted ? 0 : Math.round(player.volume * 100));
    }

    // Deezer's React UI may re-render the player bar, so this runs on every DOM change.
    function mount() {
      const group = document.querySelector('[data-testid^="volume_button"]')?.parentElement;
      if (group && group.firstElementChild !== slider) group.prepend(slider);
    }

    input.addEventListener("input", () => setVolume(Number(input.value)));
    input.addEventListener("pointerdown", () => (dragging = true));
    input.addEventListener("pointerup", () => (dragging = false));
    slider.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        setVolume(Number(input.value) + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP));
      },
      { passive: false },
    );
    setInterval(syncFromPlayer, SYNC_INTERVAL_MS);
    onReady(() => {
      mount();
      new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
    });
  }

  // --- Resume playback ---

  // Deezer's web player always starts with a default playlist, so the queue,
  // track and position are saved here and restored on startup.
  function resumePlayback() {
    const DB_NAME = "deezer-client";
    const STORE = "resume";
    const SAVE_INTERVAL_MS = 3000;
    const db = openDatabase();
    let restored = false;
    let savedSignature = null;

    function openDatabase() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function request(mode, run) {
      const tx = (await db).transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
    }

    // The player, once it has loaded a track list.
    function loadedPlayer() {
      const player = window.dzPlayer;
      return player?.getTrackList && player.getTrackList().length > 0 ? player : null;
    }

    async function save() {
      const player = loadedPlayer();
      if (!restored || !player || player.getTrackListType() === "livestream") return;
      const data = player.getTrackList();
      const signature = data.map((track) => track.UID ?? track.SNG_ID).join(",");
      const position = { signature, index: player.getIndexSong(), offset: player.getPosition() };
      await request("readwrite", (store) => {
        // The queue can be large, so it is only rewritten when it changes.
        if (signature !== savedSignature) {
          const queue = { data, context: player.getContext(), type: player.getTrackListType() };
          store.put(queue, "queue");
        }
        return store.put(position, "position");
      });
      savedSignature = signature;
    }

    async function restore() {
      const player = loadedPlayer();
      const [queue, position] = await Promise.all([
        request("readonly", (store) => store.get("queue")),
        request("readonly", (store) => store.get("position")),
      ]);
      if (!queue || !position || player.isPlaying()) return;
      savedSignature = position.signature;
      await player.play({
        data: queue.data,
        index: position.index,
        offset: position.offset,
        autoplay: false,
        context: queue.context,
        type: queue.type,
        id: queue.context?.ID,
        radio: false,
      });
    }

    // Waits for the player to load its default playlist before replacing it.
    function start() {
      if (!loadedPlayer()) {
        setTimeout(start, 500);
        return;
      }
      restore()
        .catch((err) => console.error("deezer-client: restore failed", err))
        .finally(() => {
          restored = true;
          setInterval(() => save().catch(() => {}), SAVE_INTERVAL_MS);
        });
    }

    start();
    return { save };
  }
})();
