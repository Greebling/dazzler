/* Gendern zu Deutsch – settings. Replaces the browser extension's defaults.js:
 * there is no chrome.storage here, so the values are fixed. */
(function (root: typeof globalThis) {
  'use strict';

  const DEFAULT_SETTINGS: GzDSettingsValues = {
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
