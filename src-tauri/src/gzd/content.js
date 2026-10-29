/* Gendern zu Deutsch – Content-Script: wendet GenderCore auf Textknoten und Attribute der Seite an. */
(function () {
  'use strict';

  const { loadSettings, shouldFilter } = globalThis.GzDSettings;
  const Core = globalThis.GenderCore;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE',
    'KBD', 'SAMP', 'VAR', 'SVG', 'MATH', 'TEMPLATE', 'IFRAME', 'OBJECT', 'CANVAS']);
  const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DFN', 'EM', 'I', 'MARK', 'Q', 'S', 'SMALL',
    'SPAN', 'STRONG', 'SUB', 'SUP', 'U', 'FONT', 'TIME', 'WBR', 'DATA', 'INS', 'DEL']);
  const ATTRS = ['title', 'alt', 'placeholder', 'aria-label'];
  const ATTR_SELECTOR = ATTRS.map(a => '[' + a + ']').join(',');
  // Beginn eines Textknotens, der ein im vorigen Knoten begonnenes Wort fortsetzt: Lehrer<em>*innen</em>
  const SPLIT_START = /^(?:[*:_/·•|]-?(?:innen|in|Innen|In)|\((?:innen|in|Innen|In)\)|Innen|In)(?![\p{L}\p{N}])/u;
  const MEMO_MAX = 5000;
  const SLICE_MS = 10;

  let opts = null;
  let observer = null;
  const memo = new Map();       // Originaltext -> Ergebnis (gleiche Texte kommen oft mehrfach vor)
  const written = new WeakMap(); // Textknoten -> zuletzt von uns geschriebener Inhalt
  const queue = [];             // noch zu durchsuchende Teilbäume
  let pending = [];             // gesammelte, noch nicht bearbeitete Textknoten
  let pendingPos = 0;
  let scheduled = false;

  // ------------------------------------------------------------ Text verarbeiten

  function transformText(text) {
    let r = memo.get(text);
    if (!r) {
      r = Core.transform(text, opts);
      if (memo.size >= MEMO_MAX) memo.clear();
      memo.set(text, r);
    }
    return r.text;
  }

  function isSkipped(el) {
    return SKIP_TAGS.has(el.tagName) || el.isContentEditable || el.getAttribute('role') === 'textbox';
  }

  function collectTextNodes(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      const p = root.parentElement;
      return p && !p.closest('script, style, noscript, textarea, code, pre, kbd, samp, [contenteditable=""], [contenteditable="true"]') ? [root] : [];
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return [];
    if (root.nodeType === Node.ELEMENT_NODE && (isSkipped(root) || root.closest('[contenteditable=""], [contenteditable="true"], code, pre'))) return [];
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) return isSkipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return /\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function blockOf(node) {
    let e = node.parentElement;
    while (e && INLINE_TAGS.has(e.tagName)) e = e.parentElement;
    return e;
  }

  /** Zieht Genderendungen, die in einem eigenen Knoten stehen, an das Wort im vorigen Knoten. */
  function joinSplitWords(nodes) {
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (!/\p{L}$/u.test(a.data)) continue;
      const m = SPLIT_START.exec(b.data);
      if (!m || blockOf(a) !== blockOf(b)) continue;
      if (/^In/.test(m[0]) && !/\p{Ll}$/u.test(a.data)) continue;
      a.data += m[0];
      b.data = b.data.slice(m[0].length);
    }
  }

  function processTextNode(node) {
    const text = node.data;
    if (text.length < 4 || written.get(node) === text || !node.isConnected) return;
    const out = transformText(text);
    if (out !== text) node.data = out;
    written.set(node, out);
  }

  function processAttributes(root) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const els = root.querySelectorAll ? Array.from(root.querySelectorAll(ATTR_SELECTOR)) : [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(ATTR_SELECTOR)) els.push(root);
    for (const el of els) {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && v.length >= 4) {
          const out = transformText(v);
          if (out !== v) el.setAttribute(a, out);
        }
      }
    }
  }

  // ------------------------------------------------------------ Warteschlange (verhindert Ruckeln)

  function enqueue(node, now) {
    queue.push(node);
    if (!scheduled) {
      scheduled = true;
      if (now) flush();
      else if (typeof requestIdleCallback === 'function') requestIdleCallback(flush, { timeout: 300 });
      else setTimeout(flush, 50);
    }
  }

  /** Arbeitet in Häppchen von SLICE_MS, damit auch große Seiten nicht ruckeln. */
  function flush() {
    scheduled = false;
    const start = performance.now();
    const timeUp = () => performance.now() - start > SLICE_MS;
    while (pendingPos < pending.length || queue.length) {
      if (pendingPos < pending.length) {
        // Zeit nur alle 50 Knoten prüfen; performance.now() ist nicht kostenlos
        const end = Math.min(pendingPos + 50, pending.length);
        while (pendingPos < end) processTextNode(pending[pendingPos++]);
      } else {
        const root = queue.shift();
        if (!root.isConnected) continue;
        pending = collectTextNodes(root);
        pendingPos = 0;
        joinSplitWords(pending);
        processAttributes(root);
      }
      if (timeUp() && (pendingPos < pending.length || queue.length)) {
        scheduled = true;
        setTimeout(flush, 0);
        return;
      }
    }
    pending = [];
    pendingPos = 0;
    if (document.title) {
      const t = transformText(document.title);
      if (t !== document.title) document.title = t;
    }
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          if (written.get(m.target) !== m.target.data) enqueue(m.target);
        } else {
          for (const n of m.addedNodes) enqueue(n);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  // ------------------------------------------------------------ Start

  async function start() {
    const settings = await loadSettings();
    if (!shouldFilter(settings, location.href)) return;
    opts = {
      doppelformen: settings.doppelformen,
      partizip: settings.partizip,
    };
    // Lexikon wird als Content-Script mitgeladen (data/lexicon.js), kein Umweg über das Hintergrundskript
    Core.loadLexicon(globalThis.GENDER_LEXICON || '');
    enqueue(document.body || document.documentElement, true);
    observe();
  }

  // Wird vor dem Laden der Seite eingeschleust, daher auf das DOM warten
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
