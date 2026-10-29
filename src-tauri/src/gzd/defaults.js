/* Gendern zu Deutsch – Einstellungen für den Deezer-Client.
 * Ersetzt das defaults.js der Erweiterung: Ohne Erweiterungs-API gibt es kein
 * chrome.storage, daher feste Standardwerte. */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    doppelformen: true,
    partizip: true,
    blocklist: '',
  };

  function loadSettings() {
    return Promise.resolve(Object.assign({}, DEFAULT_SETTINGS));
  }

  function shouldFilter() {
    return true;
  }

  root.GzDSettings = { DEFAULT_SETTINGS, loadSettings, shouldFilter };
})(globalThis);
