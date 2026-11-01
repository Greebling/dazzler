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
    #${PANEL_ID} .dazzler-theme { margin-top: var(--tempo-space-spacing-xl); }
    #${PANEL_ID} .dazzler-colors {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--tempo-space-spacing-m) var(--tempo-space-spacing-l);
      margin-top: var(--tempo-space-spacing-m);
    }
    #${PANEL_ID} .dazzler-colors label {
      display: flex;
      align-items: center;
      gap: var(--tempo-space-spacing-xs);
    }
    /* Circles like those of Deezer's "Design und Farbe" dialog, whose selected
       one shrinks inside a ring of its color (its color is set as the input's
       color, for currentColor). */
    #${PANEL_ID} input[type="color"] {
      appearance: none;
      box-sizing: border-box;
      width: 38px;
      height: 38px;
      padding: 0;
      border: 0 solid transparent;
      border-radius: 50%;
      outline: 2px solid transparent;
      outline-offset: -2px;
      background: none;
      cursor: pointer;
      transition: border-width 0.1s, outline-color 0.1s;
    }
    #${PANEL_ID} input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
    #${PANEL_ID} input[type="color"]::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
    }
    #${PANEL_ID} input[type="color"]:is(:hover, :focus-visible) {
      border-width: 4px;
      outline-color: currentColor;
    }
    #${PANEL_ID} .dazzler-colors button {
      margin-inline-start: auto;
      padding: var(--tempo-space-spacing-xs) var(--tempo-space-spacing-s);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-sm);
      font-size: var(--tempo-fontSizes-xs);
      color: var(--tempo-colors-text-neutral-primary-default);
    }
    #${PANEL_ID} .dazzler-preview { margin-top: var(--tempo-space-spacing-m); }
    #${PANEL_ID} .dazzler-preview > div:not([hidden]) {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--tempo-space-spacing-s);
      padding: var(--tempo-space-spacing-m);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-md);
      font-size: var(--tempo-fontSizes-xs);
    }
    #${PANEL_ID} .dazzler-preview span {
      padding: var(--tempo-space-spacing-xs) var(--tempo-space-spacing-s);
      border-radius: var(--tempo-radii-rounded);
    }
    #${PANEL_ID} .dazzler-hint {
      margin-top: var(--tempo-space-spacing-s);
      font-size: var(--tempo-fontSizes-xs);
      color: var(--tempo-colors-text-danger-primary-default, #e0423a);
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
        <div class="dazzler-theme">
          <div class="dazzler-setting">
            <label class="dazzler-label" for="dazzler-theme-enabled">Custom color scheme</label>
            <label class="dazzler-switch">
              <input id="dazzler-theme-enabled" type="checkbox" role="switch"
                aria-describedby="dazzler-theme-help">
              <span class="dazzler-switch-track" aria-hidden="true">
                <span class="dazzler-switch-thumb"></span>
              </span>
            </label>
          </div>
          <div class="dazzler-help" id="dazzler-theme-help">
            Colors the whole app in light and dark mode from an accent and a background color.
          </div>
          <div class="dazzler-colors">
            <label class="dazzler-help">Accent color
              <input id="dazzler-theme-primary" type="color"></label>
            <label class="dazzler-help">Background color
              <input id="dazzler-theme-background" type="color"></label>
            <button type="button" id="dazzler-theme-reset">Reset</button>
          </div>
          <div class="dazzler-preview" aria-hidden="true">
            <div data-mode="light"><b>Light</b><span>Text</span><span>Accent</span></div>
            <div data-mode="dark"><b>Dark</b><span>Text</span><span>Accent</span></div>
          </div>
          <div class="dazzler-hint" id="dazzler-theme-hint" role="status"></div>
        </div>
      </div>`;
    const toggle = panel.querySelector<HTMLInputElement>("#dazzler-autostart")!;

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
    setUpTheme(panel);
    return { panel, refresh };
  }

  // The custom color scheme, which inject/custom-theme.ts generates and applies.
  // The settings are shared through localStorage and an event on window.
  function setUpTheme(panel: HTMLElement) {
    const KEY = "dazzlerTheme";
    const DEFAULTS = { enabled: false, primary: "#a238ff", background: "#000000" };
    // The hint is shown below these WCAG contrast ratios: AA for text, and AA for
    // large text on the accent, whose button labels are bold (Deezer's own purple
    // is 4.0:1 in dark mode).
    const MIN_CONTRAST = 4.5;
    const MIN_ACCENT_CONTRAST = 3;
    const enabled = panel.querySelector<HTMLInputElement>("#dazzler-theme-enabled")!;
    const primary = panel.querySelector<HTMLInputElement>("#dazzler-theme-primary")!;
    const background = panel.querySelector<HTMLInputElement>("#dazzler-theme-background")!;
    const hint = panel.querySelector<HTMLElement>("#dazzler-theme-hint")!;

    function save() {
      for (const input of [primary, background]) input.style.color = input.value;
      const settings = { enabled: enabled.checked, primary: primary.value, background: background.value };
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {}
      window.dispatchEvent(new Event("dazzler-theme-change"));
    }

    function showInputs(settings: typeof DEFAULTS) {
      enabled.checked = settings.enabled;
      primary.value = settings.primary;
      background.value = settings.background;
      for (const input of [primary, background]) input.style.color = input.value;
    }

    // The preview and the hint show what custom-theme.ts generated, for the
    // mode Deezer currently shows.
    function showResult() {
      const theme = window.__dazzlerTheme;
      if (!theme) return;
      // <html> doesn't exist yet on the first call, at the start of the document.
      const current = document.documentElement?.dataset.theme === "light" ? "light" : "dark";
      const problems: string[] = [];
      for (const name of ["light", "dark"] as const) {
        const mode = theme[name];
        const box = panel.querySelector<HTMLElement>(`.dazzler-preview [data-mode="${name}"]`)!;
        box.hidden = name !== current;
        if (box.hidden) continue;
        const [text, accent] = box.querySelectorAll("span");
        box.style.background = mode.background;
        box.style.color = mode.text;
        text.style.color = mode.text;
        accent.style.background = mode.accent;
        accent.style.color = mode.onAccent;
        if (mode.accentContrast < MIN_ACCENT_CONTRAST) {
          problems.push(`Text on the accent color is hard to read (${mode.accentContrast.toFixed(1)}:1).`);
        }
        if (mode.textContrast < MIN_CONTRAST) {
          problems.push(`Text on the background is hard to read (${mode.textContrast.toFixed(1)}:1).`);
        }
      }
      hint.textContent = theme.settings.enabled ? problems.join(" ") : "";
    }

    for (const input of [enabled, primary, background]) input.addEventListener("input", save);
    attachDazzlerColorPicker(primary);
    attachDazzlerColorPicker(background);
    panel.querySelector("#dazzler-theme-reset")!.addEventListener("click", () => {
      showInputs(DEFAULTS);
      save();
    });
    window.addEventListener("dazzler-theme-applied", showResult);
    // Deezer's light/dark switch sets data-theme on <html>, which doesn't exist
    // yet when this runs at the start of the document.
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target === document.documentElement)) showResult();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });

    const saved = window.__dazzlerTheme?.settings;
    showInputs(saved ?? DEFAULTS);
    if (saved) showResult();
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
