// Small changes to Deezer's pages, mostly hiding things.

// --- Social media ---

// Hides links and buttons to Facebook, X, Instagram and TikTok (e.g. the
// social profile links on artist pages). Their domains are also blocked in main.rs.
function hideSocialMedia() {
  const domains = [
    "facebook.com",
    "fb.com",
    "fb.me",
    "twitter.com",
    "//x.com",
    ".x.com",
    "instagram.com",
    "tiktok.com",
  ];
  const icons = ["Facebook", "Twitter", "XIcon", "Instagram", "Tiktok", "TikTok"];

  const links = domains.map((domain) => `a[href*="${domain}"]`).join(", ");
  const iconSvgs = icons.map((name) => `svg[data-testid^="${name}"]`).join(", ");
  const social = `:is(${links}), :is(a, button):has(${iconSvgs})`;
  addStyle(`${social}, li:has(> :is(${social})) { display: none !important; }`);
}

// --- Sidebar playlists ---

// Hides the "by <owner>" line under each playlist in the left sidebar.
// Only the sidebar's playlist rows have the playlist-item class; each holds
// the cover and a column with the title and that line.
function hideSidebarPlaylistOwners() {
  addStyle(`
    :is(.playlist-item, .playlist-item-disabled) > :nth-child(2) > :nth-child(2) {
      display: none !important;
    }
  `);
}

// --- Quick access hint ---

// Hides the hint box in the sidebar's quick access section ("Pinne deine
// Lieblingsmusik ... in deine Sidebar"). Deezer only shows it while this
// flag, which its close button sets, is missing from localStorage.
function hideQuickAccessHint() {
  try {
    localStorage.setItem("shouldHidePinTooltip", "true");
  } catch {}
}

// --- Quick access pin icons ---

// Hides the thumbtack on the covers of the sidebar's quick access items and
// in their tooltips, the only places Deezer uses this icon.
function hideQuickAccessPins() {
  addStyle(`svg[data-testid^="ThumbtackFilledIcon"] { display: none !important; }`);
}

// --- Artist tour dates ---

// Moves the tour dates on artist pages below the discography. They are the
// last row of the section above it, so that section is dissolved
// (display: contents) into the flex column, and its rows take over its padding.
function moveArtistTourDatesDown() {
  const tour = '[data-testid="last-concert-section"]';
  const section = `.catalog-tab-discography > section:has(> ${tour})`;
  addStyle(`
    .catalog-tab-discography:has(> section > ${tour}) {
      display: flex;
      flex-direction: column;
    }
    ${section} { display: contents; }
    ${section} > * { padding-inline: 40px; }
    ${section} > ${tour} {
      order: 1;
      margin-top: 0 !important;
    }
  `);
}
