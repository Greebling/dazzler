// Media keys, run from main.rs through window.__dazzler.media.

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

// The Media Session handlers Deezer registers, as a fallback for when its
// player API isn't available.
const mediaSessionHandlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> = {};

function captureMediaSessionHandlers() {
  const ms = navigator.mediaSession;
  if (ms?.setActionHandler) {
    const original = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, handler) => {
      mediaSessionHandlers[action] = handler;
      return original(action, handler);
    };
  }
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
