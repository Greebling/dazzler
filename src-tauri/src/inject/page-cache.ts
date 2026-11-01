// Caching of Deezer's page content.

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
  // Page requests wait this long at most for the stored responses.
  const LOAD_TIMEOUT_MS = 1000;
  const HOME_REQUEST = "home-request";

  type Entry = { body: string; time: number };
  // The request for the home page, without its per-request parameters.
  type HomeRequest = { key: string; url: string; init: RequestInit };
  // Stored under their key: the entries with their key, and the home page's request.
  type Stored = (Entry & { key: string }) | { home: HomeRequest };
  // A page.get response, as far as it is used here.
  type PageResponse = { error?: object; results?: { page_name?: string } };

  const cache = new Map<string, Entry>();
  const originalFetch = window.fetch;
  const request = openObjectStore("dazzler-pages", "pages");
  let homeRequest: HomeRequest | null = null;
  let apiToken: string | null = null;

  // Fills the cache from the stored responses. Page requests wait for it, but
  // not for a stuck database.
  const loaded = Promise.race([
    request<Stored[]>("readonly", (s) => s.getAll())
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
      .catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS)),
  ]);

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
  function rememberHome(key: string, url: string, init: RequestInit | undefined, json: PageResponse) {
    if (json.results?.page_name !== "home" || homeRequest?.key === key) return;
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

  // The parsed body, if it is a page without an error.
  function parsePage(body: string): PageResponse | null {
    try {
      const json: PageResponse = JSON.parse(body);
      return json.error && Object.keys(json.error).length > 0 ? null : json;
    } catch {
      return null;
    }
  }

  function fetchAndCache(key: string, url: string, args: Parameters<typeof fetch>) {
    const response = originalFetch.apply(window, args);
    response
      .then((res) => (res.ok ? res.clone().text() : null))
      .then((body) => {
        const json = body && parsePage(body);
        if (!json) return;
        store(key, { body: body!, time: Date.now() });
        rememberHome(key, url, args[1], json);
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
