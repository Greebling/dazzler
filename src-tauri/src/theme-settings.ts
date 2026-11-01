// Injected into deezer.com: adds the settings of the custom color scheme, which
// inject/custom-theme.ts generates and applies, to Deezer's "Design und Farbe"
// dialog (profile picture, top right). The settings are shared through
// localStorage and an event on window. Uses color-picker.ts.
(() => {
  if (window.__dazzlerThemeSettings || window.top !== window) return;
  window.__dazzlerThemeSettings = true;

  const SECTION_ID = "dazzler-theme-section";
  const KEY = "dazzlerTheme";
  const DEFAULTS = { enabled: false, primary: "#a238ff", background: "#000000" };
  // The hint is shown below these WCAG contrast ratios: AA for text, and AA for
  // large text on the accent, whose button labels are bold (Deezer's own purple
  // is 4.0:1 in dark mode).
  const MIN_CONTRAST = 4.5;
  const MIN_ACCENT_CONTRAST = 3;

  // Mirrors the styles of the dialog, whose generated class names change between builds.
  const CSS = `
    /* The body has a fixed height that only fits Deezer's own content; it grows
       for the section, but scrolls if the window is too small for that. */
    .chakra-modal__body:has(> #${SECTION_ID}) {
      height: auto !important;
      max-height: calc(100vh - 220px) !important;
    }
    #${SECTION_ID} {
      display: flex;
      flex-direction: column;
      gap: var(--tempo-space-spacing-s);
      padding: var(--tempo-space-spacing-l) 16px;
      border-top: 1px solid var(--tempo-colors-divider-neutral-primary-default);
    }
    #${SECTION_ID} .dazzler-setting {
      display: flex;
      align-items: center;
    }
    #${SECTION_ID} .dazzler-label {
      margin-inline-end: var(--tempo-space-spacing-m);
      font-weight: var(--tempo-fontWeights-medium);
      font-size: var(--tempo-fontSizes-sm);
      color: var(--tempo-colors-text-neutral-primary-default);
    }
    #${SECTION_ID} .dazzler-help {
      font-size: var(--tempo-fontSizes-xs);
      line-height: var(--tempo-lineHeights-normal);
      color: var(--tempo-colors-text-neutral-secondary-default);
    }
    #${SECTION_ID} .dazzler-switch {
      --track-width: 1.875rem;
      --track-height: 1rem;
      position: relative;
      display: inline-block;
      line-height: 0;
    }
    #${SECTION_ID} .dazzler-switch input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
    #${SECTION_ID} .dazzler-switch-track {
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
    #${SECTION_ID} .dazzler-switch-thumb {
      width: var(--track-height);
      height: var(--track-height);
      border-radius: inherit;
      background: var(--tempo-colors-white);
      transition-property: transform;
      transition-duration: var(--tempo-transition-duration-normal);
    }
    #${SECTION_ID} input:checked + .dazzler-switch-track {
      background: var(--tempo-colors-background-accent-primary-default);
    }
    #${SECTION_ID} input:checked + * > .dazzler-switch-thumb {
      transform: translateX(calc(var(--track-width) - var(--track-height)));
    }
    #${SECTION_ID} input:focus-visible + .dazzler-switch-track {
      outline: 2px solid var(--tempo-colors-border-accent-primary-default);
      outline-offset: 2px;
    }
    #${SECTION_ID} .dazzler-colors {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--tempo-space-spacing-m) var(--tempo-space-spacing-l);
      margin-top: var(--tempo-space-spacing-xs);
    }
    #${SECTION_ID} .dazzler-colors label {
      display: flex;
      align-items: center;
      gap: var(--tempo-space-spacing-xs);
    }
    /* Circles like the dialog's own, whose selected one shrinks inside a ring
       of its color (its color is set as the input's color, for currentColor). */
    #${SECTION_ID} input[type="color"] {
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
    #${SECTION_ID} input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
    /* The outline keeps a color like the dialog's own background visible. */
    #${SECTION_ID} input[type="color"]::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4);
    }
    #${SECTION_ID} input[type="color"]:is(:hover, :focus-visible) {
      border-width: 4px;
      outline-color: currentColor;
    }
    #${SECTION_ID} .dazzler-colors button {
      margin-inline-start: auto;
      padding: var(--tempo-space-spacing-xs) var(--tempo-space-spacing-s);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-rounded);
      font-size: var(--tempo-fontSizes-xs);
      color: var(--tempo-colors-text-neutral-primary-default);
    }
    #${SECTION_ID} .dazzler-hint {
      font-size: var(--tempo-fontSizes-xs);
      color: var(--tempo-colors-text-danger-primary-default, #e0423a);
    }
    #${SECTION_ID} .dazzler-hint:empty { display: none; }
  `;

  const section = document.createElement("div");
  section.id = SECTION_ID;
  section.innerHTML = `
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
      Colors the whole app in light and dark mode from an accent and a background color,
      instead of the color above. Applies immediately.
    </div>
    <div class="dazzler-colors">
      <label class="dazzler-help">Accent color
        <input id="dazzler-theme-primary" type="color" aria-label="Accent color"></label>
      <label class="dazzler-help">Background color
        <input id="dazzler-theme-background" type="color" aria-label="Background color"></label>
      <button type="button" id="dazzler-theme-reset">Reset</button>
    </div>
    <div class="dazzler-hint" id="dazzler-theme-hint" role="status"></div>`;
  const enabled = section.querySelector<HTMLInputElement>("#dazzler-theme-enabled")!;
  const primary = section.querySelector<HTMLInputElement>("#dazzler-theme-primary")!;
  const background = section.querySelector<HTMLInputElement>("#dazzler-theme-background")!;
  const hint = section.querySelector<HTMLElement>("#dazzler-theme-hint")!;

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

  // Warns about what custom-theme.ts generated, in the mode Deezer currently shows.
  function showHint() {
    const theme = window.__dazzlerTheme;
    if (!theme) return;
    // <html> doesn't exist yet on the first call, at the start of the document.
    const mode = theme[document.documentElement?.dataset.theme === "light" ? "light" : "dark"];
    const problems: string[] = [];
    if (mode.accentContrast < MIN_ACCENT_CONTRAST) {
      problems.push(`Text on the accent color is hard to read (${mode.accentContrast.toFixed(1)}:1).`);
    }
    if (mode.textContrast < MIN_CONTRAST) {
      problems.push(`Text on the background is hard to read (${mode.textContrast.toFixed(1)}:1).`);
    }
    hint.textContent = theme.settings.enabled ? problems.join(" ") : "";
  }

  for (const input of [enabled, primary, background]) input.addEventListener("input", save);
  attachDazzlerColorPicker(primary);
  attachDazzlerColorPicker(background);
  section.querySelector("#dazzler-theme-reset")!.addEventListener("click", () => {
    showInputs(DEFAULTS);
    save();
  });
  window.addEventListener("dazzler-theme-applied", showHint);
  // Deezer's light/dark switch sets data-theme on <html>, which doesn't exist
  // yet when this runs at the start of the document.
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.target === document.documentElement)) showHint();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });

  const saved = window.__dazzlerTheme?.settings;
  showInputs(saved ?? DEFAULTS);
  if (saved) showHint();

  // The dialog is rendered by Deezer's React app whenever it is opened. Its body
  // is recognized by the color buttons in it.
  function mount() {
    const color = document.querySelector('.chakra-modal__body [data-testid="customise_color_button"]');
    const body = color?.closest(".chakra-modal__body");
    if (body && section.parentElement !== body) body.append(section);
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
