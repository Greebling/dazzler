// Custom colors: generates Deezer's color scales from two picked colors.

// Deezer's colors come from ~300 semantic tokens (--tempo-colors-background-...)
// that only point into three scales, and the dark mode only points them at other
// steps. Replacing the scales therefore recolors everything, in both modes.

const THEME_KEY = "dazzlerTheme";
// Dispatched on window by settings.ts after it changed THEME_KEY.
const THEME_CHANGE_EVENT = "dazzler-theme-change";
// Dispatched on window with the result in window.__dazzlerTheme.
const THEME_APPLIED_EVENT = "dazzler-theme-applied";

// --- Deezer's default scales, the reference for the generated ones ---

const NEUTRAL_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
const NEUTRAL_REF = [
  "#ffffff", "#f5f2f8", "#e2dfe6", "#d5d2d8", "#c7c5cb", "#bab8be", "#aeabb1", "#a19fa4", "#949298", "#88868b",
  "#7c7a7f", "#706e73", "#656367", "#59575c", "#4e4c51", "#434146", "#38373b", "#2e2c30", "#242326", "#141216",
  "#000000",
];
const PRIMARY_STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const LIGHT_PRIMARY_REF = [
  "#f9e8ff", "#ebceff", "#d9abff", "#c582ff", "#b355ff", "#a238ff", "#8a22de", "#6908ae", "#47007c", "#2a004e",
  "#15002d",
];
const DARK_PRIMARY_REF = [
  "#fdf3ff", "#ebd5ff", "#dab7ff", "#ca97ff", "#bb73ff", "#ad47ff", "#952ced", "#7c1bc8", "#6307a4", "#4c0081",
  "#350060",
];
// Index of step 100 in the primary scales.
const PRIMARY_ANCHOR = 5;

// --- Colors ---

type Oklch = { l: number; c: number; h: number };
type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex(rgb: Rgb) {
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return "#" + rgb.map((v) => byte(v).toString(16).padStart(2, "0")).join("");
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.782771766 * m - 0.8086757660 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, bb),
    h: Math.atan2(bb, a),
  };
}

// Linear sRGB, not limited to the gamut.
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

// The color as hex, with its chroma reduced until it is inside the sRGB gamut.
function oklchToHex(color: Oklch) {
  const l = Math.min(1, Math.max(0, color.l));
  const inGamut = (c: number) => oklchToLinear({ l, c, h: color.h }).every((v) => v >= -0.0005 && v <= 1.0005);
  let c = Math.max(0, color.c);
  if (!inGamut(c)) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (inGamut(mid)) low = mid;
      else high = mid;
    }
    c = low;
  }
  return rgbToHex(oklchToLinear({ l, c, h: color.h }).map(linearToSrgb) as Rgb);
}

// WCAG contrast ratio.
function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- Scale generation ---

// A primary scale around its step 100 (the accent): the hue of the accent, the
// lightness of the reference, and the chroma of the reference relative to its
// chroma at step 100. Where the accent is lighter or darker than the reference's
// step 100, the lightness of the other steps is stretched to stay ordered.
function generatePrimaryScale(refHex: string[], anchor: Oklch, anchorHex: string) {
  const ref = refHex.map(hexToOklch);
  const last = ref.length - 1;
  const lightEnd = Math.min(0.99, Math.max(ref[0].l, anchor.l + 0.04));
  const darkEnd = Math.max(0, Math.min(ref[last].l, anchor.l - 0.04));
  return ref.map((step, i) => {
    if (i === PRIMARY_ANCHOR) return anchorHex;
    const end = i < PRIMARY_ANCHOR ? 0 : last;
    const t = (step.l - ref[PRIMARY_ANCHOR].l) / (ref[end].l - ref[PRIMARY_ANCHOR].l);
    const l = anchor.l + t * ((i < PRIMARY_ANCHOR ? lightEnd : darkEnd) - anchor.l);
    return oklchToHex({ l, c: (anchor.c * step.c) / ref[PRIMARY_ANCHOR].c, h: anchor.h });
  });
}

// The neutral scale around the background color, which becomes its darkest step
// (200) if it is dark and its lightest (00) otherwise, so that it is the page
// background in one mode, and the text color in the other.
function generateNeutralScale(backgroundHex: string) {
  const bg = hexToOklch(backgroundHex);
  const ref = NEUTRAL_REF.map(hexToOklch);
  const last = ref.length - 1;
  const anchor = bg.l < 0.5 ? last : 0;
  const dir = anchor === 0 ? 1 : -1;
  // How far the background is from the reference's end. The steps near it follow
  // it, so they stay distinguishable from it, and the other end stays as it is.
  const offset = bg.l - ref[anchor].l;
  // The far end is a faint tint of the hue, and the chroma fades towards it.
  const tint = Math.min(bg.c, 0.03);
  const result: string[] = [];
  let prev = bg.l;
  for (let n = 0; n <= last; n++) {
    const i = anchor + dir * n;
    const t = n / last;
    const fade = (1 - t) ** 2;
    // Strictly ordered away from the background.
    const shifted = ref[i].l + offset * fade;
    const l = n === 0 ? bg.l : dir === 1 ? Math.min(shifted, prev - 0.01) : Math.max(shifted, prev + 0.01);
    prev = Math.min(0.995, Math.max(0.005, l));
    result[i] = n === 0 ? backgroundHex : oklchToHex({ l: prev, c: bg.c * fade + tint * t ** 4, h: bg.h });
  }
  return result;
}

interface ThemeSettings {
  enabled: boolean;
  primary: string;
  background: string;
}

// The two scales and the neutral one, as CSS variables.
function generateThemeVariables({ primary, background }: ThemeSettings) {
  const accent = hexToOklch(primary);
  const refLight = hexToOklch(LIGHT_PRIMARY_REF[PRIMARY_ANCHOR]);
  const refDark = hexToOklch(DARK_PRIMARY_REF[PRIMARY_ANCHOR]);
  // Deezer's dark accent is a little brighter and more vivid than its light one.
  const darkAccent: Oklch = {
    l: Math.min(0.98, accent.l + refDark.l - refLight.l),
    c: accent.c * (refDark.c / refLight.c),
    h: accent.h,
  };
  const light = generatePrimaryScale(LIGHT_PRIMARY_REF, accent, primary);
  const dark = generatePrimaryScale(DARK_PRIMARY_REF, darkAccent, oklchToHex(darkAccent));
  const neutral = generateNeutralScale(background);

  const variables: Record<string, string> = {};
  NEUTRAL_STEPS.forEach((step, i) => (variables[`neutralPrimary-${String(step).padStart(2, "0")}`] = neutral[i]));
  PRIMARY_STEPS.forEach((step, i) => {
    variables[`lightPrimary-${step}`] = light[i];
    variables[`darkPrimary-${step}`] = dark[i];
  });
  return variables;
}

// --- Applying ---

function loadThemeSettings(): ThemeSettings {
  const settings: ThemeSettings = { enabled: false, primary: "#a238ff", background: "#000000" };
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) ?? "null");
    const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
    settings.enabled = saved?.enabled === true;
    if (isHex(saved?.primary)) settings.primary = saved.primary.toLowerCase();
    if (isHex(saved?.background)) settings.background = saved.background.toLowerCase();
  } catch {}
  return settings;
}

function customizeColors() {
  const style = document.createElement("style");
  style.id = "dazzler-theme";

  function apply() {
    const settings = loadThemeSettings();
    const vars = generateThemeVariables(settings);
    // :root:root and [data-theme][data-theme] also beat Deezer's own palettes
    // (the theme picker sets some on nested [data-theme] elements).
    style.textContent = settings.enabled
      ? `:root:root, [data-theme][data-theme] {\n${Object.entries(vars)
          .map(([name, value]) => `  --tempo-colors-${name}: ${value} !important;`)
          .join("\n")}\n}`
      : "";

    // For the preview and the contrast hints in settings.ts: the semantic
    // colors of each mode (which steps they use is Deezer's choice).
    const mode = (bgStep: string, textStep: string, accentStep: string) => {
      const background = vars[`neutralPrimary-${bgStep}`];
      const text = vars[`neutralPrimary-${textStep}`];
      const accent = vars[accentStep];
      const onAccent = vars["neutralPrimary-00"];
      return {
        background,
        text,
        accent,
        onAccent,
        textContrast: contrastRatio(background, text),
        accentContrast: contrastRatio(accent, onAccent),
      };
    };
    window.__dazzlerTheme = {
      settings,
      light: mode("00", "200", "lightPrimary-100"),
      dark: mode("200", "00", "darkPrimary-100"),
    };
    window.dispatchEvent(new Event(THEME_APPLIED_EVENT));
  }

  apply();
  // As early as possible, so the default colors never show. When this runs at
  // the start of the document, not even its <html> element exists yet.
  if (document.documentElement) {
    document.documentElement.append(style);
  } else {
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      document.documentElement.append(style);
    }).observe(document, { childList: true });
  }
  window.addEventListener(THEME_CHANGE_EVENT, apply);
  rememberBackground();
}

// Tells main.rs the page's background color whenever it changes (the custom
// colors, or Deezer's light/dark switch), which the window then shows on the
// next start until the page paints.
function rememberBackground() {
  const KEY = "dazzlerBackground";
  let timer: number | undefined;

  function report() {
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--tempo-colors-background-neutral-primary-default")
      .trim()
      .toLowerCase();
    // Empty until Deezer's styles are loaded.
    if (!/^#[0-9a-f]{6}$/.test(color)) return;
    try {
      if (localStorage.getItem(KEY) === color) return;
      localStorage.setItem(KEY, color);
    } catch {}
    window.__TAURI_INTERNALS__.invoke("set_background_color", { color }).catch(() => {});
  }
  // Waits for the change to settle, e.g. while a color is being dragged.
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(report, 500);
  }

  window.addEventListener("load", schedule);
  window.addEventListener(THEME_APPLIED_EVENT, schedule);
  // Deezer's light/dark switch sets data-theme on <html>, which doesn't exist
  // yet when this runs at the start of the document.
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.target === document.documentElement)) schedule();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });
}
