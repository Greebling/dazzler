// Globals shared by the injected scripts, and the parts of Deezer's page they use.

type MediaAction = "playpause" | "play" | "pause" | "nexttrack" | "previoustrack";

// window.playerProxy.control
interface DeezerPlayerControl {
  togglePause(): void;
  play(): void;
  pause(): void;
  nextSong(): void;
  prevSong(): void;
}

interface DeezerTrack {
  UID?: string | number;
  SNG_ID?: string | number;
  [key: string]: unknown;
}

interface DeezerContext {
  ID?: string | number;
  TYPE?: string;
  [key: string]: unknown;
}

interface DeezerPlayOptions {
  data: DeezerTrack[];
  index: number;
  offset: number;
  autoplay: boolean;
  context?: DeezerContext;
  type: string;
  id?: string | number;
  radio: boolean;
}

// window.dzPlayer
interface DeezerPlayer {
  control?: { setVolume(volume: number, save: boolean): void };
  muted: boolean;
  volume: number;
  getDuration(): number;
  getPosition(): number;
  isPlaying(): boolean;
  getTrackList(): DeezerTrack[];
  getTrackListType(): string;
  getIndexSong(): number;
  getContext(): DeezerContext;
  play: ((options: DeezerPlayOptions) => unknown) & { dazzlerWrapped?: boolean };
}

interface Window {
  // Set by inject.ts; called from main.rs.
  __dazzler?: { media(action: MediaAction): void; beforeClose(): void };
  // Set by settings.ts.
  __dazzlerSettings?: boolean;
  __TAURI_INTERNALS__: { invoke<T = unknown>(command: string, args?: unknown): Promise<T> };
  playerProxy?: { control?: DeezerPlayerControl };
  dzPlayer?: DeezerPlayer;
  __DZR_APP_STATE__?: unknown;
}

// --- Gendern zu Deutsch (gzd/) ---

interface GzDOptions {
  doppelformen?: boolean;
  partizip?: boolean;
  eigene?: string;
  ausnahmen?: string;
}

interface GzDCounts {
  binnenI: number;
  doppelformen: number;
  partizip: number;
}

interface GzDResult {
  text: string;
  counts: GzDCounts;
}

interface GzDCompiledOptions {
  doppelformen: boolean;
  partizip: boolean;
  custom: [RegExp, string][];
  isException(s: string): boolean;
}

interface GzDSettingsValues {
  doppelformen: boolean;
  partizip: boolean;
  blocklist: string;
}

// Set by gzd/defaults.ts.
declare var GzDSettings: {
  DEFAULT_SETTINGS: GzDSettingsValues;
  loadSettings(): Promise<GzDSettingsValues>;
  shouldFilter(settings: GzDSettingsValues, url: string): boolean;
};

// Set by gzd/gender-core.ts.
declare var GenderCore: {
  transform(text: string, opts?: GzDOptions | null): GzDResult;
  loadLexicon(data: string): number;
  lexiconSize(): number;
  parseList(str: unknown): string[];
  parseCustom(str: unknown): string[][];
  compileOptions(opts?: GzDOptions | null): GzDCompiledOptions;
};

// Set by gzd/data/lexicon.ts.
declare var GENDER_LEXICON: string | undefined;
