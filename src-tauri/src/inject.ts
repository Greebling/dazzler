// Injected into deezer.com before the page's own scripts run.
(() => {
  if (window.__dazzler || window.top !== window) return;

  // Deezer's player controls (window.playerProxy.control) per media action.
  const MEDIA_CONTROLS: Record<MediaAction, keyof DeezerPlayerControl> = {
    playpause: "togglePause",
    play: "play",
    pause: "pause",
    nexttrack: "nextSong",
    previoustrack: "prevSong",
  };

  // Player bar buttons, used when the player API isn't available.
  const MEDIA_BUTTONS: Record<MediaAction, string[]> = {
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
  hideQuickAccessHint();
  hideQuickAccessPins();
  moveArtistTourDatesDown();
  restoreScrollOnBack();
  enlargePlayerBar();
  addVolumeSlider();
  smoothProgressBar();
  const resume = resumePlayback();

  // Called from main.rs.
  window.__dazzler = {
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

  // --- Media keys ---

  // Captures the Media Session handlers Deezer registers, as a fallback for
  // when its player API isn't available.
  function captureMediaSessionHandlers() {
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> = {};
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

  function runMediaAction(action: MediaAction) {
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
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean);
    button?.click();
  }

  // --- Page cache ---

  // Deezer fetches page content (page.get) fresh on every visit, which takes
  // up to a second. Serves the last response at once and refreshes it in the
  // background, so returning to e.g. the home page is instant. The responses
  // are kept across restarts, and the home page is fetched once the app has
  // started, as the first visit to it after starting has nothing cached yet
  // (the start page's content comes embedded in the HTML instead).
  function cachePageContent() {
    const MAX_AGE_MS = 48 * 60 * 60 * 1000; // h m s ms
    const MAX_ENTRIES = 100;
    // After Deezer's first request, so it doesn't compete with the start page loading.
    const PREFETCH_DELAY_MS = 5000;
    // A home page cached this recently isn't fetched again.
    const PREFETCH_FRESH_MS = 120 * 1000;
    const HOME_REQUEST = "home-request";

    type Entry = { body: string; time: number };
    // The request for the home page, without its per-request parameters.
    type HomeRequest = { key: string; url: string; init: RequestInit };
    // Stored under their key: the entries with their key, and the home page's request.
    type Stored = (Entry & { key: string }) | { home: HomeRequest };

    const cache = new Map<string, Entry>();
    const originalFetch = window.fetch;
    const request = openObjectStore("dazzler-pages", "pages");
    let homeRequest: HomeRequest | null = null;
    let apiToken: string | null = null;

    // Fills the cache from the stored responses; page requests wait for it.
    const loaded = request<Stored[]>("readonly", (s) => s.getAll())
      .then((stored) => {
        // Sorted by time, so that the map's order is the fetch order like for new entries.
        const entries = stored.filter((v): v is Entry & { key: string } => "key" in v).sort((a, b) => a.time - b.time);
        for (const { key, body, time } of entries) {
          // Fetched meanwhile, which is newer.
          if (!cache.has(key)) cache.set(key, { body, time });
        }
        const home = stored.find((v): v is { home: HomeRequest } => "home" in v);
        homeRequest ??= home?.home ?? null;
      })
      .catch(() => {});

    function store(key: string, entry: Entry) {
      cache.delete(key);
      cache.set(key, entry);
      // The map is in insertion order, so the first entries are the least recently fetched.
      const removed = [...cache.keys()].slice(0, Math.max(0, cache.size - MAX_ENTRIES));
      for (const old of removed) cache.delete(old);
      request("readwrite", (s) => {
        for (const old of removed) s.delete(old);
        return s.put({ ...entry, key } satisfies Stored, key);
      }).catch(() => {});
    }

    // Per-request (cid) and per-session (api_token) parameters don't change
    // the content, but the user (in a header) does.
    function pageUrl(url: RequestInfo | URL) {
      if (typeof url !== "string" || !url.includes("method=page.get")) return null;
      const u = new URL(url, location.href);
      u.searchParams.delete("cid");
      u.searchParams.delete("api_token");
      return u.toString();
    }

    function cacheKey(url: string, init?: RequestInit) {
      return `${url}#user=${new Headers(init?.headers).get("x-deezer-user") ?? ""}`;
    }

    // Remembers the home page's request when it is fetched, to fetch it on the next start.
    function rememberHome(key: string, url: string, init: RequestInit | undefined, body: string) {
      try {
        if (JSON.parse(body).results?.page_name !== "home" || homeRequest?.key === key) return;
      } catch {
        return;
      }
      const { credentials, method, mode } = init ?? {};
      homeRequest = { key, url, init: { credentials, method, mode, headers: Object.fromEntries(new Headers(init?.headers)) } };
      request("readwrite", (s) => s.put({ home: homeRequest! } satisfies Stored, HOME_REQUEST)).catch(() => {});
    }

    // Deezer's requests carry the session's api_token, which a request of our own needs too.
    function noteApiToken(input: RequestInfo | URL) {
      if (apiToken || typeof input !== "string" || !input.includes("/ajax/gw-light.php")) return;
      apiToken = new URL(input, location.href).searchParams.get("api_token") || null;
      if (apiToken) setTimeout(() => loaded.then(prefetchHome), PREFETCH_DELAY_MS);
    }

    function prefetchHome() {
      const cached = homeRequest && cache.get(homeRequest.key);
      if (!homeRequest || !apiToken || (cached && Date.now() - cached.time < PREFETCH_FRESH_MS)) return;
      const url = new URL(homeRequest.url);
      url.searchParams.set("api_token", apiToken);
      url.searchParams.set("cid", String(Math.floor(Math.random() * 1e9)));
      fetchAndCache(homeRequest.key, homeRequest.url, [url.toString(), homeRequest.init]).catch(() => {});
    }

    function hasError(body: string) {
      try {
        const error = JSON.parse(body).error;
        return error && Object.keys(error).length > 0;
      } catch {
        return true;
      }
    }

    function fetchAndCache(key: string, url: string, args: Parameters<typeof fetch>) {
      const response = originalFetch.apply(window, args);
      response
        .then((res) => (res.ok ? res.clone().text() : null))
        .then((body) => {
          if (!body || hasError(body)) return;
          store(key, { body, time: Date.now() });
          rememberHome(key, url, args[1], body);
        })
        .catch(() => {});
      return response;
    }

    window.fetch = function (this: Window, ...args) {
      const [input, init] = args;
      noteApiToken(input);
      const url = pageUrl(input);
      if (!url || (init?.method && init.method !== "GET")) {
        return originalFetch.apply(this, args);
      }
      const key = cacheKey(url, init);
      const refresh = fetchAndCache(key, url, args);
      return loaded.then(() => {
        const cached = cache.get(key);
        if (!cached || Date.now() - cached.time > MAX_AGE_MS) return refresh;
        refresh.catch(() => {});
        return new Response(cached.body, { headers: { "Content-Type": "application/json" } });
      });
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
    let userId: string | null = null;

    // Items and sections of a page.get result, as far as they are used here.
    type PageItem = {
      type?: string;
      title?: string;
      description?: string;
      data?: { PARENT_USER_ID?: unknown; TITLE?: string; DESCRIPTION?: string };
    };
    type PageSection = { section_id?: string; items?: PageItem[] };
    type Page = { page_name?: string; sections?: PageSection[] };

    function isHidden(item: PageItem) {
      const data = item.data ?? {};
      if (item.type !== "playlist" || String(data.PARENT_USER_ID) === userId) return false;
      return WORDS.test(`${data.TITLE ?? item.title ?? ""} ${data.DESCRIPTION ?? item.description ?? ""}`);
    }

    // page: a page.get result, e.g. { page_name: "home", sections: [{ items: [...] }] }.
    function filterPage(value: unknown) {
      const page = value as Page | null | undefined;
      if (page?.page_name !== "home" || !Array.isArray(page.sections)) return value;
      const sections = page.sections
        .map((section) =>
          Array.isArray(section.items)
            ? { ...section, items: section.items.filter((item) => !isHidden(item)) }
            : section,
        )
        .filter((section) => !Array.isArray(section.items) || section.items.length > 0);
      return { ...page, sections: moveMixesBelowPlaylists(sections) };
    }

    // Moves the "Mixes inspired by..." section (found by its content source,
    // as its title is localized) below the user's own playlists.
    function moveMixesBelowPlaylists(sections: PageSection[]) {
      const source = (section: PageSection) => section.section_id ?? "";
      const mixes = sections.find((s) => source(s).includes("track_content-source_user-tops"));
      const playlists = sections.find((s) => source(s).includes("playlists_content-source_user-favorites"));
      if (!mixes || !playlists || sections.indexOf(mixes) > sections.indexOf(playlists)) return sections;
      const rest = sections.filter((s) => s !== mixes);
      rest.splice(rest.indexOf(playlists) + 1, 0, mixes);
      return rest;
    }

    // Filtered when read, so that the user's ID is known by then.
    let appState: unknown;
    let filtered: { source: unknown; userId: string | null; page: unknown } | null = null;
    Object.defineProperty(window, "__DZR_APP_STATE__", {
      configurable: true,
      get() {
        if (!filtered || filtered.source !== appState || filtered.userId !== userId) {
          filtered = { source: appState, userId, page: filterPage(appState) };
        }
        return filtered.page;
      },
      set(value) {
        appState = value;
      },
    });

    async function filterResponse(response: Response) {
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

    window.fetch = function (this: Window, ...args) {
      const [input] = args;
      const response = originalFetch.apply(this, args);
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

  // --- Quick access hint ---

  // Hides the hint box in the sidebar's quick access section ("Pinne deine
  // Lieblingsmusik ... in deine Sidebar"). Deezer only shows it while this
  // flag, which its close button sets, is missing from localStorage.
  function hideQuickAccessHint() {
    try {
      localStorage.setItem("shouldHidePinTooltip", "true");
    } catch {}
  }

  // --- Quick access pin icons ---

  // Hides the thumbtack on the covers of the sidebar's quick access items and
  // in their tooltips, the only places Deezer uses this icon.
  function hideQuickAccessPins() {
    addStyle(`svg[data-testid^="ThumbtackFilledIcon"] { display: none !important; }`);
  }

  // --- Artist tour dates ---

  // Moves the tour dates on artist pages below the discography. They are the
  // last row of the section above it, so that section is dissolved
  // (display: contents) into the flex column, and its rows take over its padding.
  function moveArtistTourDatesDown() {
    const tour = '[data-testid="last-concert-section"]';
    const section = `.catalog-tab-discography > section:has(> ${tour})`;
    addStyle(`
      .catalog-tab-discography:has(> section > ${tour}) {
        display: flex;
        flex-direction: column;
      }
      ${section} { display: contents; }
      ${section} > * { padding-inline: 40px; }
      ${section} > ${tour} {
        order: 1;
        margin-top: 0 !important;
      }
    `);
  }

  // --- Player bar ---

  // Scales the bottom player bar (80px by default) with its content, and makes
  // the page and the sidebar leave room for the taller bar.
  function enlargePlayerBar() {
    const SCALE = 1.3;
    const height = Math.round(80 * SCALE);
    const bar = 'div:has(> div > div > div > [data-testid^="play_button"])';
    addStyle(`
      ${bar} {
        zoom: ${SCALE};
      }
      .naboo, .page-topbar + div > div { padding-bottom: ${height}px !important; }
    `);
  }

  // --- Scroll restoration ---

  // React internals of Deezer's progressively rendered lists (e.g. the followed
  // artists): all items are known up front, but only the first `count` are
  // rendered, and the count is raised while scrolling.
  type Hook = { memoizedState: unknown; queue: { dispatch?: (count: number) => void } | null; next: Hook | null };
  type Fiber = {
    child: Fiber | null;
    sibling: Fiber | null;
    memoizedProps: { items?: unknown; renderItem?: unknown } | null;
    memoizedState: Hook | null;
  };

  // The rendered count of the progressive list on the page, if there is one.
  function findProgressiveList() {
    const grid = document.querySelector('[data-testid="thumbnail-grid"]');
    const key = grid && Object.keys(grid).find((k) => k.startsWith("__reactFiber"));
    if (!grid || !key) return null;

    const find = (fiber: Fiber | null, depth: number): Fiber | null => {
      for (; fiber; fiber = fiber.sibling) {
        const props = fiber.memoizedProps;
        if (Array.isArray(props?.items) && typeof props.renderItem === "function") return fiber;
        const found = depth < 4 ? find(fiber.child, depth + 1) : null;
        if (found) return found;
      }
      return null;
    };
    const list = find((grid as unknown as Record<string, Fiber>)[key].child, 0);
    for (let hook = list?.memoizedState ?? null; hook; hook = hook.next) {
      const setCount = hook.queue?.dispatch;
      if (setCount && typeof hook.memoizedState === "number") {
        return { count: hook.memoizedState, setCount };
      }
    }
    return null;
  }

  // A position in a list: the first entry link in view, and its distance from the top.
  type Anchor = { href: string; top: number };

  function findAnchor(): Anchor | null {
    const links = document.querySelectorAll<HTMLAnchorElement>('[data-testid="thumbnail-grid"] a[href]');
    for (const link of links) {
      const top = link.getBoundingClientRect().top;
      if (top >= 0) return { href: link.getAttribute("href")!, top };
    }
    return null;
  }

  // The scroll position that puts the anchor back where it was, once its entry is rendered.
  function anchorScrollY(anchor: Anchor) {
    const selector = `[data-testid="thumbnail-grid"] a[href="${CSS.escape(anchor.href)}"]`;
    const link = document.querySelector(selector);
    return link && window.scrollY + link.getBoundingClientRect().top - anchor.top;
  }

  // Long lists render more entries while scrolling, so after going back, the
  // page is too short for the position it was left at and Deezer's own
  // restoration ends up higher. Remembers the scroll position, the entry at the
  // top and the rendered count of each page when it is left. After going back
  // it renders that many entries at once, and scrolls down for any that are
  // still missing, with the page hidden meanwhile. Scrolling to the entry
  // rather than to the pixel position keeps working when the window was
  // resized or something above the list has a different height.
  function restoreScrollOnBack() {
    const INTERVAL_MS = 30;
    const SETTLE_MS = 300;
    const GIVE_UP_MS = 3000;
    const MAX_MS = 60_000;
    // How long the list is watched for going back to its first entries after the position is restored.
    const GUARD_MS = 10_000;
    // The list loads its next entries when the bottom comes into view again, so
    // it has to leave the view in between; this is much quicker than staying at the bottom.
    const WIGGLE_PX = 300;
    const HIDING = "dazzler-restoring";
    addStyle(`
      .page-main { transition: opacity 0.15s; }
      .${HIDING} .page-main { opacity: 0 !important; transition: none; }
    `);
    type Saved = { y: number; anchor: Anchor | null; count: number | null };
    const positions = new Map<string, Saved>();
    let currentPath = location.pathname;
    // Stops restoring or guarding the position; returns whether it was still restoring.
    let cancel: (() => boolean) | null = null;
    // Otherwise the browser scrolls before popstate, and the position of the page being left is lost.
    history.scrollRestoration = "manual";

    // Called right before the page changes, while its scroll position is still intact.
    function leave() {
      // Left while still restoring: the position isn't the user's, keep the saved one.
      if (cancel?.()) return;
      positions.set(currentPath, {
        y: window.scrollY,
        anchor: findAnchor(),
        count: findProgressiveList()?.count ?? null,
      });
    }

    function arrive() {
      currentPath = location.pathname;
    }

    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const url = args[2];
        const changes = url != null && new URL(url, location.href).pathname !== currentPath;
        if (changes) leave();
        const result = original.apply(this, args);
        if (changes) arrive();
        return result;
      };
    }

    // Captured, to run before Deezer's router renders the next page.
    window.addEventListener(
      "popstate",
      () => {
        leave();
        arrive();
        const saved = positions.get(currentPath);
        if (saved?.y) restore(saved);
      },
      true,
    );

    function restore(saved: Saved) {
      const path = currentPath;
      let { y, anchor, count } = saved;
      const start = Date.now();
      let timer: ReturnType<typeof setInterval> | null = null;
      let guardTimer: ReturnType<typeof setTimeout> | null = null;
      let lastHeight = 0;
      let lastGrowth = start;
      let settledSince: number | null = null;
      let atBottom = false;
      let tracking = false;

      // Returns whether it was still restoring, rather than guarding.
      const stop = () => {
        const restoring = timer !== null;
        if (timer !== null) clearInterval(timer);
        if (guardTimer !== null) clearTimeout(guardTimer);
        observer.disconnect();
        document.documentElement.classList.remove(HIDING);
        for (const type of INTERACTIONS) window.removeEventListener(type, interrupt, true);
        window.removeEventListener("scroll", track);
        if (cancel === stop) cancel = null;
        return restoring;
      };
      // The user scrolling takes over, with the list still watched; not while
      // the page is hidden, though, as the position is meaningless then. Nor
      // does a click, e.g. one that focuses the window, except on the scrollbar.
      const interrupt = (event: Event) => {
        if (timer === null || document.documentElement.classList.contains(HIDING)) return;
        if (event.type !== "mousedown" || event.target === document.documentElement) settle();
      };
      const INTERACTIONS = ["wheel", "touchstart", "keydown", "mousedown"];
      for (const type of INTERACTIONS) window.addEventListener(type, interrupt, true);
      cancel = stop;

      // Deezer's list goes back to its first entries whenever it is given its
      // items anew, which happens a moment after the page is shown again, e.g.
      // after the position was restored. For a while after, the list is
      // lengthened again and the position restored, before the short list is
      // painted. Once the user has scrolled, it is their position.
      const observer = new MutationObserver(() => {
        const list = timer === null && count !== null ? findProgressiveList() : null;
        if (!list || list.count >= count!) return;
        document.documentElement.classList.add(HIDING);
        run();
      });
      function track() {
        if (tracking) return;
        tracking = true;
        requestAnimationFrame(() => {
          tracking = false;
          if (timer !== null) return;
          y = window.scrollY;
          anchor = findAnchor();
          count = Math.max(count ?? 0, findProgressiveList()?.count ?? 0);
        });
      }

      function settle() {
        clearInterval(timer!);
        timer = null;
        document.documentElement.classList.remove(HIDING);
        // Without a count there is no list to watch.
        if (count === null) return stop();
        if (guardTimer !== null) return;
        guardTimer = setTimeout(stop, GUARD_MS);
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener("scroll", track, { passive: true });
      }

      function run() {
        lastHeight = 0;
        lastGrowth = Date.now();
        settledSince = null;
        timer = setInterval(tick, INTERVAL_MS);
      }

      function tick() {
        const now = Date.now();
        if (location.pathname !== path || now - start > MAX_MS) return stop();
        const height = document.documentElement.scrollHeight;
        if (height > lastHeight) {
          lastHeight = height;
          lastGrowth = now;
        }
        const maxScroll = height - window.innerHeight;
        // Also when Deezer has gone back to the first entries meanwhile.
        const list = count === null ? null : findProgressiveList();
        if (list && list.count < count!) {
          settledSince = null;
          document.documentElement.classList.add(HIDING);
          list.setCount(count!);
          return;
        }
        // The entry is rendered by the time the page is long enough for the
        // pixel position; if it is missing then, e.g. an unfollowed artist, the
        // pixel position is the best there is.
        const target = Math.max(0, (anchor && anchorScrollY(anchor)) ?? y);
        if (maxScroll >= target) {
          window.scrollTo(0, target);
          // Deezer may still replace the content or scroll, so wait until it stays put.
          if (Math.abs(window.scrollY - target) > 1) settledSince = null;
          else if (settledSince === null) settledSince = now;
          else if (now - settledSince >= SETTLE_MS) settle();
        } else {
          // Scrolling to the bottom makes the list load its next entries.
          settledSince = null;
          document.documentElement.classList.add(HIDING);
          atBottom = !atBottom;
          window.scrollTo(0, atBottom ? maxScroll : Math.max(0, maxScroll - WIGGLE_PX));
          if (now - lastGrowth > GIVE_UP_MS) stop();
        }
      }

      // A list starts out with its first entries, which shouldn't show.
      if (count !== null) document.documentElement.classList.add(HIDING);
      run();
    }
  }

  // --- Volume slider ---

  // Replaces the volume button (whose slider only exists while its hover
  // popover is open) with an always visible slider at the start of its button group.
  // It reuses Deezer's own slider classes for the look.
  function addVolumeSlider() {
    const WHEEL_STEP = 5;
    const SYNC_INTERVAL_MS = 500;
    const STORAGE_KEY = "dazzler-volume";

    addStyle(`
      [data-testid^="volume_button"] { display: none !important; }
      #dazzler-volume {
        width: 140px;
        margin: 0 16px 0 0;
        align-self: center;
        padding: 2px 0;
      }
      #dazzler-volume .slider-track-default {
        background-color: var(--tempo-colors-background-neutral-tertiary-default, #232326);
      }
      #dazzler-volume .slider-track-active {
        background-color: var(--tempo-colors-background-accent-primary-default, #97b5ff);
      }
    `);

    const slider = document.createElement("div");
    slider.id = "dazzler-volume";
    slider.className = "slider";
    slider.innerHTML = `
      <div class="slider-track">
        <div class="slider-track-default"></div>
        <div class="slider-track-active"></div>
        <input class="slider-track-input" type="range" min="0" max="100" step="1" aria-label="Volume">
      </div>`;
    const input = slider.querySelector("input")!;
    const active = slider.querySelector<HTMLElement>(".slider-track-active")!;
    let dragging = false;

    function show(value: number) {
      input.value = String(value);
      active.style.width = `${value}%`;
    }

    function setVolume(value: number) {
      value = Math.max(0, Math.min(100, value));
      show(value);
      window.dzPlayer?.control?.setVolume(value / 100, true);
      localStorage.setItem(STORAGE_KEY, String(value));
    }

    // Applies the volume of the previous session once the player exists.
    let restored = false;
    function restoreVolume(player: DeezerPlayer) {
      restored = true;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null && Number.isFinite(Number(saved))) {
        player.control?.setVolume(Number(saved) / 100, true);
      }
    }

    // Follows volume changes made elsewhere (e.g. muting, other devices).
    function syncFromPlayer() {
      const player = window.dzPlayer;
      if (!player || dragging) return;
      if (!restored) restoreVolume(player);
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
        // Keeps the page behind the slider from scrolling too.
        e.preventDefault();
        e.stopPropagation();
        setVolume(Number(input.value) + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP));
      },
      { passive: false, capture: true },
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
    let lastPosition: number | null = null;
    let lastTime = 0;
    let dragging = false;
    // While a seek is pending: its target (0-1), its distance (0-1) from the
    // position before it, and when to stop waiting for it.
    let seek: { target: number; distance: number; until: number } | null = null;

    // --dazzler-progress (0-1) and --dazzler-progress-px are set in frame.
    addStyle(`
      ${TRACK} > .slider-track-active {
        width: 100% !important;
        clip-path: inset(0 calc(100% - var(--dazzler-progress, 0) * 100%) 0 0 round 4px);
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
        transform: translateX(var(--dazzler-progress-px, 0px));
        pointer-events: none;
      }
      .slider-autohide:not(.is-active) > ${TRACK}::after {
        opacity: 0;
      }
    `);

    function progressInput() {
      return document.querySelector<HTMLInputElement>('[data-testid="progress_bar"]');
    }

    // The position to show (0-1) while playing, or null to show Deezer's.
    function smoothedProgress(now: number) {
      const player = window.dzPlayer;
      const duration = player?.getDuration?.();
      if (!player?.isPlaying?.() || !duration || !(duration > 0)) return null;
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

    function frame(now: number) {
      requestAnimationFrame(frame);
      const input = progressInput();
      const track = input?.parentElement;
      if (!input || !track) return;
      // Lets clicks land between whole seconds; they are floored on release.
      if (input.step !== "any") input.step = "any";
      let progress = dragging ? null : smoothedProgress(now);
      if (progress === null) {
        lastPosition = null;
        progress = dragging
          ? Number(input.value) / Number(input.max)
          : (parseFloat(track.querySelector<HTMLElement>(".slider-track-active")?.style.width ?? "") || 0) / 100;
      }
      track.style.setProperty("--dazzler-progress", String(progress));
      track.style.setProperty(
        "--dazzler-progress-px",
        // offsetWidth, unlike the bounding rect, ignores the player bar's zoom.
        `${progress * track.offsetWidth}px`,
      );
    }

    // Leaves the bar to Deezer while seeking with the mouse, and until the
    // player reports the new position. Captured, so nothing can stop them first.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if ((e.target as Element).closest?.('[data-testid="progress_bar"]')) dragging = true;
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
          if (dragging && input && player && duration && duration > 0) {
            // Deezer seeks to the input's value on mouseup, which comes after this.
            // Setting it earlier, while dragging, would make React skip Deezer's
            // change handler.
            input.value = String(Math.floor(Number(input.value)));
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
    const SAVE_INTERVAL_MS = 3000;
    const request = openObjectStore("dazzler", "resume");
    let restored = false;
    let savedSignature: string | null = null;

    type SavedQueue = { data: DeezerTrack[]; context: DeezerContext; type: string };
    type SavedPosition = { signature: string; index: number; offset: number };

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
      const position: SavedPosition = { signature, index: player.getIndexSong(), offset: player.getPosition() };
      await request("readwrite", (store) => {
        // The queue can be large, so it is only rewritten when it changes.
        if (signature !== savedSignature) {
          const queue: SavedQueue = { data, context: player.getContext(), type: player.getTrackListType() };
          store.put(queue, "queue");
        }
        return store.put(position, "position");
      });
      savedSignature = signature;
    }

    // The options for player.play() that load the saved queue, or null.
    async function savedPlayOptions(): Promise<DeezerPlayOptions | null> {
      const [queue, position] = await Promise.all([
        request<SavedQueue | undefined>("readonly", (store) => store.get("queue")),
        request<SavedPosition | undefined>("readonly", (store) => store.get("position")),
      ]);
      if (!queue || !position) return null;
      savedSignature = position.signature;
      return {
        data: queue.data,
        index: position.index,
        offset: position.offset,
        autoplay: false,
        context: queue.context,
        type: queue.type,
        id: queue.context?.ID,
        radio: false,
      };
    }

    async function restore() {
      const player = loadedPlayer()!;
      if (replacedDefault || player.isPlaying()) return;
      const options = await savedPlayOptions();
      if (options) await player.play(options);
    }

    // Without a queue of its own, Deezer plays its default playlist
    // (dzPlayer.play with context type player_default_playlist). The saved
    // queue is played in its place, so the default track never shows.
    let replacedDefault = false;
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
          if (!restored && !replacedDefault && options?.context?.TYPE === "player_default_playlist") {
            const saved = await savedPlayOptions().catch(() => null);
            if (saved) {
              replacedDefault = true;
              return play.call(this, saved);
            }
          }
          return play.apply(this, args);
        };
        player.play.dazzlerWrapped = true;
      },
    });

    // Waits for the player to load a track list before replacing it.
    function start() {
      if (!loadedPlayer()) {
        setTimeout(start, 500);
        return;
      }
      restore()
        .catch((err) => console.error("dazzler: restore failed", err))
        .finally(() => {
          restored = true;
          setInterval(() => save().catch(() => {}), SAVE_INTERVAL_MS);
        });
    }

    start();
    return { save };
  }
})();
