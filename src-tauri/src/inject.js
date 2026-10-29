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
  filterHomePlaylists();
  hideSocialMedia();
  hideSidebarPlaylistOwners();
  addVolumeSlider();
  smoothProgressBar();
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

  // --- Home page filter ---

  // Removes playlists from the home page whose title or description contains
  // one of these words, unless the user created them. The home page's sections
  // come embedded in the HTML (window.__DZR_APP_STATE__) on the first load and
  // from page.get afterwards; both are filtered.
  function filterHomePlaylists() {
    const WORDS = /pride|queer|diversity|empower/i;
    const originalFetch = window.fetch;
    let userId = null;

    function isHidden(item) {
      const data = item.data ?? {};
      if (item.type !== "playlist" || String(data.PARENT_USER_ID) === userId) return false;
      return WORDS.test(`${data.TITLE ?? item.title ?? ""} ${data.DESCRIPTION ?? item.description ?? ""}`);
    }

    // page: a page.get result, e.g. { page_name: "home", sections: [{ items: [...] }] }.
    function filterPage(page) {
      if (page?.page_name !== "home" || !Array.isArray(page.sections)) return page;
      const sections = page.sections
        .map((section) =>
          Array.isArray(section.items)
            ? { ...section, items: section.items.filter((item) => !isHidden(item)) }
            : section,
        )
        .filter((section) => !Array.isArray(section.items) || section.items.length > 0);
      return { ...page, sections };
    }

    // Filtered when read, so that the user's ID is known by then.
    let appState;
    let filtered = null;
    Object.defineProperty(window, "__DZR_APP_STATE__", {
      configurable: true,
      get() {
        if (filtered?.source !== appState || filtered.userId !== userId) {
          filtered = { source: appState, userId, page: filterPage(appState) };
        }
        return filtered.page;
      },
      set(value) {
        appState = value;
      },
    });

    async function filterResponse(response) {
      try {
        const body = await response.clone().json();
        body.results = filterPage(body.results);
        return new Response(JSON.stringify(body), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    }

    window.fetch = function (input) {
      const response = originalFetch.apply(this, arguments);
      if (typeof input !== "string" || !input.includes("/ajax/gw-light.php")) return response;
      const method = new URL(input, location.href).searchParams.get("method");
      if (method === "deezer.getUserData") {
        response
          .then((res) => res.clone().json())
          .then((body) => (userId = String(body.results.USER.USER_ID)))
          .catch(() => {});
        return response;
      }
      return method === "page.get" ? response.then(filterResponse) : response;
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

  // --- Sidebar playlists ---

  // Hides the "by <owner>" line under each playlist in the left sidebar.
  // Only the sidebar's playlist rows have the playlist-item class; each holds
  // the cover and a column with the title and that line.
  function hideSidebarPlaylistOwners() {
    addStyle(`
      :is(.playlist-item, .playlist-item-disabled) > :nth-child(2) > :nth-child(2) {
        display: none !important;
      }
    `);
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

  // --- Progress bar ---

  // Deezer only updates the progress bar about four times a second, and its
  // dot (the range input's thumb) in whole seconds, so both move in steps.
  // Between its updates, this advances them every frame from the last
  // reported position. Both are drawn with transforms and clipping, which
  // unlike widths and the native thumb aren't rounded to whole pixels.
  function smoothProgressBar() {
    // Stops advancing if the player stalls (e.g. buffering) without reporting it.
    const MAX_EXTRAPOLATION_S = 0.5;
    // The player reports the old position for a moment after a seek.
    const SEEK_TIMEOUT_MS = 1500;
    const SEEK_TOLERANCE = 0.01;
    const TRACK = '.slider-track:has(> [data-testid="progress_bar"])';
    let lastPosition = null;
    let lastTime = 0;
    let dragging = false;
    // While a seek is pending: its target (0-1), its distance (0-1) from the
    // position before it, and when to stop waiting for it.
    let seek = null;

    // --deezer-client-progress (0-1) and --deezer-client-progress-px are set in frame.
    addStyle(`
      ${TRACK} > .slider-track-active {
        width: 100% !important;
        clip-path: inset(0 calc(100% - var(--deezer-client-progress, 0) * 100%) 0 0 round 4px);
      }
      ${TRACK} > .slider-track-input::-webkit-slider-thumb {
        opacity: 0 !important;
      }
      ${TRACK}::after {
        content: "";
        position: absolute;
        top: 50%;
        left: -6px;
        width: 12px;
        height: 12px;
        margin-top: -6px;
        box-sizing: border-box;
        border: 1px solid var(--tempo-colors-border-neutral-primary-default);
        border-radius: 50%;
        background-color: var(--tempo-colors-background-accent-onDark-default);
        transform: translateX(var(--deezer-client-progress-px, 0px));
        pointer-events: none;
      }
      .slider-autohide:not(.is-active) > ${TRACK}::after {
        opacity: 0;
      }
    `);

    function progressInput() {
      return document.querySelector('[data-testid="progress_bar"]');
    }

    // The position to show (0-1) while playing, or null to show Deezer's.
    function smoothedProgress(now) {
      const player = window.dzPlayer;
      const duration = player?.getDuration?.();
      if (!player?.isPlaying?.() || !(duration > 0)) return null;
      const position = player.getPosition();
      if (seek) {
        // Seeks can land a little off the target, so getting much closer counts too.
        const distance = Math.abs(position / duration - seek.target);
        const arrived = distance <= SEEK_TOLERANCE || distance < seek.distance / 2;
        if (!arrived && now < seek.until) return seek.target;
        seek = null;
      }
      if (position !== lastPosition) {
        lastPosition = position;
        lastTime = now;
      }
      const elapsed = Math.min((now - lastTime) / 1000, MAX_EXTRAPOLATION_S);
      return Math.min(1, (position + elapsed) / duration);
    }

    function frame(now) {
      requestAnimationFrame(frame);
      const input = progressInput();
      const track = input?.parentElement;
      if (!track) return;
      // Lets clicks land between whole seconds; they are floored on release.
      if (input.step !== "any") input.step = "any";
      let progress = dragging ? null : smoothedProgress(now);
      if (progress === null) {
        lastPosition = null;
        progress = dragging
          ? Number(input.value) / Number(input.max)
          : (parseFloat(track.querySelector(".slider-track-active")?.style.width) || 0) / 100;
      }
      track.style.setProperty("--deezer-client-progress", progress);
      track.style.setProperty(
        "--deezer-client-progress-px",
        `${progress * track.getBoundingClientRect().width}px`,
      );
    }

    // Leaves the bar to Deezer while seeking with the mouse, and until the
    // player reports the new position. Captured, so nothing can stop them first.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target.closest?.('[data-testid="progress_bar"]')) dragging = true;
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel"]) {
      document.addEventListener(
        type,
        () => {
          const input = progressInput();
          const player = window.dzPlayer;
          const duration = player?.getDuration?.();
          if (dragging && input && duration > 0) {
            // Deezer seeks to the input's value on mouseup, which comes after this.
            // Setting it earlier, while dragging, would make React skip Deezer's
            // change handler.
            input.value = String(Math.floor(input.value));
            const target = Number(input.value) / Number(input.max);
            const distance = Math.abs(player.getPosition() / duration - target);
            seek = { target, distance, until: performance.now() + SEEK_TIMEOUT_MS };
          }
          dragging = false;
        },
        true,
      );
    }
    requestAnimationFrame(frame);
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
