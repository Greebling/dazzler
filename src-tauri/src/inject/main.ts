// Injected into deezer.com before the page's own scripts run. build.rs joins
// the scripts in this directory into one, inside a function of its own, with
// this one last, so everything the others declare is there when it runs.
if (!window.__dazzler && window.top === window) {
  customizeColors();
  captureMediaSessionHandlers();
  cachePageContent();
  filterHomePlaylists();
  hideSocialMedia();
  hideSidebarPlaylistOwners();
  hideQuickAccessHint();
  hideQuickAccessPins();
  moveArtistTourDatesDown();
  simplifyAccountMenu();
  hideAccountAppsTab();
  replaceContextMenu();
  playArtistTopTracks();
  restoreScrollOnBack();
  enlargePlayerBar();
  addVolumeSlider();
  smoothProgressBar();
  const resume = resumePlayback();

  // Called from main.rs.
  window.__dazzler = {
    // action: "playpause", "play", "pause", "nexttrack" or "previoustrack".
    media(action) {
      runMediaAction(action);
    },

    // Called before the app exits.
    beforeClose() {
      window.playerProxy?.control?.pause();
      resume.save().catch(() => {});
    },
  };
}
