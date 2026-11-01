// Filtering and reordering of the home page's sections.

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
