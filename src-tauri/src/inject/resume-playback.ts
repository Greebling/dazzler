// Resuming playback where it was when the app was closed.

// Deezer's web player always starts with a default playlist, so the queue,
// track and position are saved here and restored on startup.
function resumePlayback() {
  const SAVE_INTERVAL_MS = 3000;
  const request = openObjectStore("dazzler", "resume");
  let restored = false;
  let savedSignature: string | null = null;

  type SavedQueue = { data: DeezerTrack[]; context: DeezerContext; type: string };
  type SavedPosition = { signature: string; index: number; offset: number };

  // The player, once it has loaded a track list.
  function loadedPlayer() {
    const player = window.dzPlayer;
    return player?.getTrackList && player.getTrackList().length > 0 ? player : null;
  }

  async function save() {
    const player = loadedPlayer();
    if (!restored || !player || player.getTrackListType() === "livestream") return;
    const data = player.getTrackList();
    const signature = data.map((track) => track.UID ?? track.SNG_ID).join(",");
    const position: SavedPosition = { signature, index: player.getIndexSong(), offset: player.getPosition() };
    await request("readwrite", (store) => {
      // The queue can be large, so it is only rewritten when it changes.
      if (signature !== savedSignature) {
        const queue: SavedQueue = { data, context: player.getContext(), type: player.getTrackListType() };
        store.put(queue, "queue");
      }
      return store.put(position, "position");
    });
    savedSignature = signature;
  }

  // The options for player.play() that load the saved queue, or null.
  async function savedPlayOptions(): Promise<DeezerPlayOptions | null> {
    const [queue, position] = await Promise.all([
      request<SavedQueue | undefined>("readonly", (store) => store.get("queue")),
      request<SavedPosition | undefined>("readonly", (store) => store.get("position")),
    ]);
    if (!queue || !position) return null;
    savedSignature = position.signature;
    return {
      data: queue.data,
      index: position.index,
      offset: position.offset,
      autoplay: false,
      context: queue.context,
      type: queue.type,
      id: queue.context?.ID,
      radio: false,
    };
  }

  async function restore() {
    const player = loadedPlayer()!;
    if (replacedDefault || player.isPlaying()) return;
    const options = await savedPlayOptions();
    if (options) await player.play(options);
  }

  // Without a queue of its own, Deezer plays its default playlist
  // (dzPlayer.play with context type player_default_playlist). The saved
  // queue is played in its place, so the default track never shows.
  let replacedDefault = false;
  replacePlayOptions(async (options) => {
    if (restored || replacedDefault || options.context?.TYPE !== "player_default_playlist") return null;
    const saved = await savedPlayOptions().catch(() => null);
    if (saved) replacedDefault = true;
    return saved;
  });

  // Waits for the player to load a track list before replacing it.
  function start() {
    if (!loadedPlayer()) {
      setTimeout(start, 500);
      return;
    }
    restore()
      .catch((err) => console.error("dazzler: restore failed", err))
      .finally(() => {
        restored = true;
        setInterval(() => save().catch(() => {}), SAVE_INTERVAL_MS);
      });
  }

  start();
  return { save };
}
