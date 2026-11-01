// Injected into deezer.com before settings.ts: a color picker popup in Deezer's
// style, replacing the browser's own popup of <input type="color">, which can't
// be styled. The input keeps its value and gets the usual "input" events.

// Opens the popup instead of the browser's when the input is clicked.
function attachDazzlerColorPicker(input: HTMLInputElement) {
  input.addEventListener("click", (event) => {
    event.preventDefault();
    openDazzlerColorPicker(input);
  });
}

// The popup below (or above, if there's no room) the input, open until a click
// outside it or Escape.
function openDazzlerColorPicker(input: HTMLInputElement) {
  const CSS = `
    .dazzler-picker {
      position: fixed;
      z-index: var(--tempo-zIndices-popover, 1500);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      width: 320px;
      padding: 1.25rem;
      background: var(--tempo-colors-background-neutral-tertiary-default);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-m, 1rem);
      box-shadow: var(--tempo-shadows-dark-lg);
      color: var(--tempo-colors-text-neutral-primary-default);
    }
    .dazzler-picker-area {
      position: relative;
      height: 200px;
      border-radius: var(--tempo-radii-s, 0.75rem);
      background:
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
      cursor: crosshair;
      touch-action: none;
    }
    .dazzler-picker-hue {
      position: relative;
      height: 15px;
      margin-inline: 10px;
      border-radius: var(--tempo-radii-full, 9999px);
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      box-shadow: -10px 0 #f00, 10px 0 #f00;
      cursor: pointer;
      touch-action: none;
    }
    .dazzler-picker-thumb {
      position: absolute;
      width: 22px;
      height: 22px;
      border: 4px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.4);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .dazzler-picker-hue .dazzler-picker-thumb { top: 50%; }
    .dazzler-picker :is(.dazzler-picker-area, .dazzler-picker-hue):focus-visible {
      outline: 2px solid var(--tempo-colors-border-accent-primary-default);
      outline-offset: 2px;
    }
    .dazzler-picker-row {
      display: flex;
      align-items: center;
      gap: 0.9375rem;
    }
    .dazzler-picker-swatch {
      flex: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4);
    }
    .dazzler-picker-hex {
      flex: 1;
      min-width: 0;
      height: 40px;
      padding: 0 1rem;
      background: var(--tempo-colors-background-neutral-primary-default);
      border: 1px solid var(--tempo-colors-border-neutral-primary-default);
      border-radius: var(--tempo-radii-full, 9999px);
      font: inherit;
      font-size: 1.09rem;
      color: inherit;
      text-transform: uppercase;
    }
    .dazzler-picker-hex:focus-visible {
      outline: 2px solid var(--tempo-colors-border-accent-primary-default);
      outline-offset: -1px;
    }
  `;
  if (!document.getElementById("dazzler-picker-style")) {
    const style = document.createElement("style");
    style.id = "dazzler-picker-style";
    style.textContent = CSS;
    document.head.append(style);
  }
  document.querySelector(".dazzler-picker")?.remove();

  function hexToHsv(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }

  function hsvToHex(h: number, s: number, v: number) {
    const channel = (n: number) => {
      const k = (n + h / 60) % 6;
      const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(value * 255).toString(16).padStart(2, "0");
    };
    return `#${channel(5)}${channel(3)}${channel(1)}`;
  }

  // The color as hue (0-360), saturation and value (0-1), so the hue survives
  // when the color is dragged to black or grey.
  let [h, s, v] = hexToHsv(input.value);

  const popup = document.createElement("div");
  popup.className = "dazzler-picker";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", input.getAttribute("aria-label") ?? "Color");
  popup.innerHTML = `
    <div class="dazzler-picker-area" role="slider" tabindex="0"
      aria-label="Saturation and brightness"><div class="dazzler-picker-thumb"></div></div>
    <div class="dazzler-picker-hue" role="slider" tabindex="0" aria-label="Hue"
      aria-valuemin="0" aria-valuemax="360"><div class="dazzler-picker-thumb"></div></div>
    <div class="dazzler-picker-row">
      <div class="dazzler-picker-swatch"></div>
      <input class="dazzler-picker-hex" type="text" maxlength="7" spellcheck="false" aria-label="Hex">
    </div>`;
  const area = popup.querySelector<HTMLElement>(".dazzler-picker-area")!;
  const hue = popup.querySelector<HTMLElement>(".dazzler-picker-hue")!;
  const areaThumb = area.firstElementChild as HTMLElement;
  const hueThumb = hue.firstElementChild as HTMLElement;
  const swatch = popup.querySelector<HTMLElement>(".dazzler-picker-swatch")!;
  const hex = popup.querySelector<HTMLInputElement>(".dazzler-picker-hex")!;

  // Shows the current color; with `commit`, also sets it on the input.
  function update(commit: boolean, fromHex = false) {
    const color = hsvToHex(h, s, v);
    popup.style.setProperty("--hue", String(h));
    areaThumb.style.left = `${s * 100}%`;
    areaThumb.style.top = `${(1 - v) * 100}%`;
    areaThumb.style.background = color;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${h} 100% 50%)`;
    area.setAttribute("aria-valuetext", `${Math.round(s * 100)}% saturation, ${Math.round(v * 100)}% brightness`);
    hue.setAttribute("aria-valuenow", String(Math.round(h)));
    swatch.style.background = color;
    if (!fromHex) hex.value = color;
    if (commit && input.value !== color) {
      input.value = color;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Dragging on the area or the hue bar, from the pointer's position in it.
  function drag(element: HTMLElement, set: (x: number, y: number) => void) {
    const move = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      set(clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height));
      update(true);
    };
    element.addEventListener("pointerdown", (event) => {
      element.setPointerCapture(event.pointerId);
      element.addEventListener("pointermove", move);
      move(event);
    });
    element.addEventListener("pointerup", () => element.removeEventListener("pointermove", move));
  }
  drag(area, (x, y) => ((s = x), (v = 1 - y)));
  drag(hue, (x) => (h = x * 360));

  // Arrow keys move in steps of 1%, with Shift 10%.
  function keys(element: HTMLElement, step: (dx: number, dy: number) => void) {
    element.addEventListener("keydown", (event) => {
      const amount = event.shiftKey ? 0.1 : 0.01;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-amount, 0],
        ArrowRight: [amount, 0],
        ArrowUp: [0, amount],
        ArrowDown: [0, -amount],
      };
      if (!(event.key in moves)) return;
      event.preventDefault();
      step(...moves[event.key]);
      update(true);
    });
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  keys(area, (dx, dy) => ((s = clamp(s + dx)), (v = clamp(v + dy))));
  keys(hue, (dx, dy) => (h = Math.min(360, Math.max(0, h + (dx + dy) * 360))));

  hex.addEventListener("input", () => {
    const value = hex.value.trim().replace(/^#?/, "#");
    if (!/^#[0-9a-f]{6}$/i.test(value)) return;
    [h, s, v] = hexToHsv(value.toLowerCase());
    update(true, true);
  });
  hex.addEventListener("blur", () => update(false));

  function close() {
    popup.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onEscape, true);
    window.removeEventListener("resize", close);
  }
  function onOutside(event: PointerEvent) {
    if (!popup.contains(event.target as Node) && event.target !== input) close();
  }
  function onEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    input.focus();
  }
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onEscape, true);
  window.addEventListener("resize", close);

  update(false);
  document.body.append(popup);
  // Below the input, or above it if it doesn't fit; inside the window horizontally.
  const anchor = input.getBoundingClientRect();
  const { width, height } = popup.getBoundingClientRect();
  const gap = 8;
  const below = anchor.bottom + gap + height <= innerHeight;
  popup.style.top = `${below ? anchor.bottom + gap : Math.max(gap, anchor.top - gap - height)}px`;
  popup.style.left = `${Math.min(Math.max(gap, anchor.left), innerWidth - width - gap)}px`;
  area.focus();
}
