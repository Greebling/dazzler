// Playing an artist plays the artist's top songs, instead of a mix based on
// the artist: from its picture (the play button that shows when hovering it,
// e.g. on the home page), and from the "Mix" button on the artist's page,
// which becomes a "Play" button.

function playArtistTopTracks() {
  const MAX_TRACKS = 100;
  const BUTTON = '[data-testid="artist-play-button"]';
  const LABEL = "Play";

  replacePlayOptions(async (options) => {
    // The pictures play radio of type "artist" in contexts like
    // dynamic_page_artist_radio, the button on the artist's page in artist_smartradio.
    if (options.type !== "artist" || !options.radio) return null;
    const artistId = String(options.id ?? options.context?.ID ?? "");
    if (!artistId) return null;
    const top = await deezerApi<{ data?: DeezerTrack[] }>("artist.getTopTrack", { art_id: artistId, nb: MAX_TRACKS });
    // Without top songs, the mix plays after all.
    if (!top?.data?.length) return null;
    // As when a song of the artist's "Top-Titel" is played on their page.
    return {
      ...options,
      data: top.data,
      index: 0,
      offset: 0,
      type: "track",
      id: artistId,
      context: { ID: artistId, TYPE: "artist_top" },
      radio: false,
    };
  });

  // The button's text is in one label per state of the button (all "Mix"),
  // which React may render again, so it is replaced in CSS.
  addStyle(`
    ${BUTTON} .states-button-label { font-size: 0; }
    ${BUTTON} .states-button-label::after {
      content: "${LABEL}";
      font-size: 0.9375rem;
    }
  `);
  // And its name for screen readers.
  onReady(() => {
    const rename = () => {
      for (const button of document.querySelectorAll(BUTTON)) {
        if (button.getAttribute("aria-label") !== LABEL) button.setAttribute("aria-label", LABEL);
      }
    };
    rename();
    new MutationObserver(rename).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  });
}
