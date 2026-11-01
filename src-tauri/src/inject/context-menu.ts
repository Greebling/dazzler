// Right-click: no browser context menu; on a song in a list (a playlist, an
// album, the favorite songs), its own menu opens instead at the pointer, the
// one of the three dots at the end of its row.

function replaceContextMenu() {
  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target as Element;
      // Text fields keep theirs, for copying and pasting.
      if (target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
      event.preventDefault();
      // The three dots are the only button in the row that opens a popover.
      const menu = target
        .closest?.('[role="row"]')
        ?.querySelector<HTMLButtonElement>('button.popper-wrapper[aria-haspopup="dialog"]');
      if (menu) openAt(menu, event.clientX, event.clientY);
    },
    true,
  );

  // Deezer positions the menu next to the box of its button, so while it is
  // open, that box is the point under the pointer.
  function openAt(button: HTMLButtonElement, x: number, y: number) {
    if (button.getAttribute("aria-expanded") === "true") button.click();
    button.getBoundingClientRect = () => new DOMRect(x, y, 0, 0);
    const restore = new MutationObserver(() => {
      if (button.getAttribute("aria-expanded") === "true") return;
      restore.disconnect();
      delete (button as Partial<HTMLButtonElement>).getBoundingClientRect;
    });
    restore.observe(button, { attributes: true, attributeFilter: ["aria-expanded"] });
    button.click();
  }
}
