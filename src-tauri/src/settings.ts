// Injected into deezer.com: adds a "Dazzler" tab with the client's own settings
// to Deezer's account settings page.
(() => {
  if (window.__dazzlerSettings || window.top !== window) return;
  window.__dazzlerSettings = true;

  const TAB_ID = "dazzler-tab";
  const PANEL_ID = "dazzler-settings";
  // Set on #page_account while the Dazzler tab is open.
  const OPEN_CLASS = "dazzler-settings-open";

  // Mirrors the styles of Deezer's own settings tabs, whose generated class
  // names change between builds.
  const CSS = `
    #page_account.${OPEN_CLASS} > :not(section, #${PANEL_ID}) { display: none !important; }
    #page_account:not(.${OPEN_CLASS}) > #${PANEL_ID} { display: none; }
    #${PANEL_ID} {
      display: flex;
      justify-content: center;
      width: 100%;
      padding: var(--tempo-space-spacing-xl);
    }
    #${PANEL_ID} .dazzler-card {
      width: 100%;
      max-width: var(--tempo-sizes-container-lg);
      padding: var(--tempo-space-spacing-xl);
      background: var(--tempo-colors-background-neutral-secondary-default);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-lg);
    }
    #${PANEL_ID} h2 {
      font-family: var(--tempo-fonts-heading-m);
      font-weight: var(--tempo-fontWeights-heading-m);
      font-size: var(--tempo-fontSizes-heading-m);
      font-stretch: var(--tempo-fontStretchs-heading-m);
      line-height: var(--tempo-lineHeights-heading-m);
    }
    #${PANEL_ID} hr {
      width: 100%;
      margin: var(--tempo-space-spacing-m) 0 var(--tempo-space-spacing-l);
      border: solid;
      border-width: 0 0 1px;
      border-color: inherit;
      opacity: 0.6;
    }
    #${PANEL_ID} .dazzler-setting {
      display: flex;
      align-items: center;
    }
    #${PANEL_ID} .dazzler-label {
      margin-inline-end: var(--tempo-space-spacing-m);
      font-weight: var(--tempo-fontWeights-medium);
      font-size: var(--tempo-fontSizes-sm);
      color: var(--tempo-colors-text-neutral-primary-default);
    }
    #${PANEL_ID} .dazzler-help {
      font-size: var(--tempo-fontSizes-xs);
      line-height: var(--tempo-lineHeights-normal);
      color: var(--tempo-colors-text-neutral-secondary-default);
    }
    #${PANEL_ID} .dazzler-switch {
      --track-width: 1.875rem;
      --track-height: 1rem;
      position: relative;
      display: inline-block;
      line-height: 0;
    }
    #${PANEL_ID} .dazzler-switch input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
    #${PANEL_ID} .dazzler-switch-track {
      display: inline-flex;
      box-sizing: content-box;
      width: var(--track-width);
      height: var(--track-height);
      padding: var(--tempo-space-spacing-xs);
      border-radius: var(--tempo-radii-rounded);
      background: var(--tempo-colors-background-neutral-tertiary-default);
      cursor: pointer;
      transition-property: var(--tempo-transition-property-common);
      transition-duration: var(--tempo-transition-duration-fast);
    }
    #${PANEL_ID} .dazzler-switch-thumb {
      width: var(--track-height);
      height: var(--track-height);
      border-radius: inherit;
      background: var(--tempo-colors-white);
      transition-property: transform;
      transition-duration: var(--tempo-transition-duration-normal);
    }
    #${PANEL_ID} input:checked + .dazzler-switch-track {
      background: var(--tempo-colors-background-accent-primary-default);
    }
    #${PANEL_ID} input:checked + * > .dazzler-switch-thumb {
      transform: translateX(calc(var(--track-width) - var(--track-height)));
    }
    #${PANEL_ID} input:disabled + .dazzler-switch-track { cursor: not-allowed; }
    #${PANEL_ID} input:focus-visible + .dazzler-switch-track {
      outline: 2px solid var(--tempo-colors-border-accent-primary-default);
      outline-offset: 2px;
    }
  `;

  // Commands of the autostart plugin, registered in main.rs.
  function invoke<T>(command: "is_enabled" | "enable" | "disable") {
    return window.__TAURI_INTERNALS__.invoke<T>(`plugin:autostart|${command}`);
  }

  function createTab() {
    const tab = document.createElement("li");
    tab.id = TAB_ID;
    tab.className = "navbar-item";
    tab.innerHTML = `<a class="chakra-text navbar-link" role="tab" tabindex="0" aria-selected="false">Dazzler</a>`;
    // Deezer's link styles come from generated classes; copied from a sibling when mounting.
    return tab;
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="dazzler-card">
        <h2>Dazzler</h2>
        <hr>
        <div class="dazzler-setting">
          <label class="dazzler-label" for="dazzler-autostart">Autostart</label>
          <label class="dazzler-switch">
            <input id="dazzler-autostart" type="checkbox" role="switch"
              aria-describedby="dazzler-autostart-help" disabled>
            <span class="dazzler-switch-track" aria-hidden="true">
              <span class="dazzler-switch-thumb"></span>
            </span>
          </label>
        </div>
        <div class="dazzler-help" id="dazzler-autostart-help">
          Start the client in the background when you log in.
        </div>
      </div>`;
    const toggle = panel.querySelector("input")!;

    function show(enabled: boolean) {
      toggle.checked = enabled;
      toggle.disabled = false;
    }

    function refresh() {
      invoke<boolean>("is_enabled")
        .then(show)
        .catch((err) => console.error("dazzler: autostart unavailable", err));
    }

    toggle.addEventListener("change", () => {
      invoke(toggle.checked ? "enable" : "disable")
        .catch((err) => console.error("dazzler: changing autostart failed", err))
        .finally(refresh);
    });
    return { panel, refresh };
  }

  const tab = createTab();
  const { panel, refresh } = createPanel();
  const link = tab.firstElementChild as HTMLAnchorElement;

  function setOpen(page: HTMLElement, open: boolean) {
    page.classList.toggle(OPEN_CLASS, open);
    tab.classList.toggle("active", open);
    link.setAttribute("aria-selected", String(open));
    // Only the highlight is removed from Deezer's selected tab, so it can be restored
    // without Deezer re-rendering (which it skips if that tab gets clicked again).
    const selected = page.querySelector(`.navbar-item:not(#${TAB_ID}) > [aria-selected="true"]`);
    selected?.parentElement?.classList.toggle("active", !open);
  }

  link.addEventListener("click", () => {
    const page = document.getElementById("page_account");
    if (!page || page.classList.contains(OPEN_CLASS)) return;
    setOpen(page, true);
    refresh();
  });
  link.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      link.click();
    }
  });

  // Any of Deezer's tabs closes ours. Captured, so it runs before Deezer re-renders.
  document.addEventListener(
    "click",
    (e) => {
      const page = document.getElementById("page_account");
      if (!page?.classList.contains(OPEN_CLASS)) return;
      const target = e.target as Element;
      if (target.closest?.(`#page_account [role="tab"]`) && !tab.contains(target)) {
        setOpen(page, false);
      }
    },
    true,
  );

  // The account page is rendered by Deezer's React app whenever it is visited.
  function mount() {
    const page = document.getElementById("page_account");
    const nav = page?.querySelector(".navbar-nav");
    if (!page || !nav) return;
    if (tab.parentElement !== nav) {
      const sibling = nav.querySelector(".navbar-link");
      link.className = sibling?.className ?? link.className;
      nav.insertBefore(tab, nav.querySelector(".navbar-dropdown"));
    }
    if (panel.parentElement !== page) {
      page.classList.remove(OPEN_CLASS);
      tab.classList.remove("active");
      link.setAttribute("aria-selected", "false");
      page.append(panel);
    }
  }

  const style = document.createElement("style");
  style.textContent = CSS;
  function start() {
    document.head.append(style);
    mount();
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
