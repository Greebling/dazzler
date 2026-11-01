// The bottom player bar: its size, volume slider and progress bar.

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
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {}
  }

  // Applies the volume of the previous session once the player can take it.
  let restored = false;
  function restoreVolume(player: DeezerPlayer) {
    if (!player.control) return;
    restored = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (saved !== null && Number.isFinite(Number(saved))) {
      player.control.setVolume(Number(saved) / 100, true);
    }
  }

  // Follows volume changes made elsewhere (e.g. muting, other devices).
  function syncFromPlayer() {
    const player = window.dzPlayer;
    if (!player || dragging) return;
    if (!restored) restoreVolume(player);
    show(player.muted ? 0 : Math.round(player.volume * 100));
  }

  // Deezer's React UI may re-render the player bar, so this runs on every DOM
  // change; mostly the slider is still in place.
  function mount() {
    if (slider.isConnected && slider.parentElement?.firstElementChild === slider) return;
    const group = document.querySelector('[data-testid^="volume_button"]')?.parentElement;
    if (group && group.firstElementChild !== slider) group.prepend(slider);
  }

  input.addEventListener("input", () => setVolume(Number(input.value)));
  input.addEventListener("pointerdown", () => (dragging = true));
  // The pointer may be released outside the slider.
  for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(type, () => (dragging = false), true);
  }
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
  // While nothing moves (paused, no seek), Deezer's own updates are followed this often.
  const IDLE_INTERVAL_MS = 200;
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

  // Runs frame on the next frame, or after a while when idle.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let frameRequested = false;
  function schedule(idle: boolean) {
    if (frameRequested || idleTimer !== null) return;
    if (idle) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        schedule(false);
      }, IDLE_INTERVAL_MS);
    } else {
      frameRequested = true;
      requestAnimationFrame((now) => {
        frameRequested = false;
        frame(now);
      });
    }
  }

  // Ends an idle wait, e.g. when the user starts seeking.
  function wake() {
    if (idleTimer === null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
    schedule(false);
  }

  function frame(now: number) {
    let progress = dragging ? null : smoothedProgress(now);
    schedule(progress === null && !dragging && !seek);
    const input = progressInput();
    const track = input?.parentElement;
    if (!input || !track) return;
    // Lets clicks land between whole seconds; they are floored on release.
    if (input.step !== "any") input.step = "any";
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
      if ((e.target as Element).closest?.('[data-testid="progress_bar"]')) {
        dragging = true;
        wake();
      }
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
        wake();
      },
      true,
    );
  }
  schedule(false);
}
