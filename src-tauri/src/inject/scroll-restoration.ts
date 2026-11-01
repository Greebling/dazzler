// Restoring the scroll position after going back.

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
    // Since when the list has been asked for more entries without having them.
    let resizingSince: number | null = null;

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
        resizingSince ??= now;
        if (now - resizingSince > GIVE_UP_MS) return stop();
        settledSince = null;
        document.documentElement.classList.add(HIDING);
        list.setCount(count!);
        return;
      }
      resizingSince = null;
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
