/* Gendern zu Deutsch – applies GenderCore to the page's text nodes and attributes. */
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
  // Start of a text node that continues a word from the previous node: Lehrer<em>*innen</em>
  const SPLIT_START = /^(?:[*:_/·•|]-?(?:innen|in|Innen|In)|\((?:innen|in|Innen|In)\)|Innen|In)(?![\p{L}\p{N}])/u;
  const MEMO_MAX = 5000;
  const SLICE_MS = 10;

  let opts: GzDOptions | null = null;
  let observer: MutationObserver | null = null;
  const memo = new Map<string, GzDResult>(); // original text -> result; the same texts often repeat
  const written = new WeakMap<Node, string>(); // text node -> content we last wrote
  const queue: Node[] = []; // subtrees still to scan
  let pending: Text[] = []; // collected text nodes not yet processed
  let pendingPos = 0;
  let scheduled = false;

  // ------------------------------------------------------------ Processing

  function transformText(text: string) {
    let r = memo.get(text);
    if (!r) {
      r = Core.transform(text, opts);
      if (memo.size >= MEMO_MAX) memo.clear();
      memo.set(text, r);
    }
    return r.text;
  }

  function isSkipped(el: Element) {
    return SKIP_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable || el.getAttribute('role') === 'textbox';
  }

  function collectTextNodes(root: Node): Text[] {
    if (root.nodeType === Node.TEXT_NODE) {
      const p = root.parentElement;
      return p && !p.closest('script, style, noscript, textarea, code, pre, kbd, samp, [contenteditable=""], [contenteditable="true"]') ? [root as Text] : [];
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return [];
    if (root.nodeType === Node.ELEMENT_NODE && (isSkipped(root as Element) || (root as Element).closest('[contenteditable=""], [contenteditable="true"], code, pre'))) return [];
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) return isSkipped(n as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return /\S/.test((n as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    return nodes;
  }

  function blockOf(node: Node) {
    let e = node.parentElement;
    while (e && INLINE_TAGS.has(e.tagName)) e = e.parentElement;
    return e;
  }

  /** Moves gender endings that sit in their own node onto the word in the previous node. */
  function joinSplitWords(nodes: Text[]) {
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

  function processTextNode(node: Text) {
    const text = node.data;
    if (text.length < 4 || written.get(node) === text || !node.isConnected) return;
    const out = transformText(text);
    if (out !== text) node.data = out;
    written.set(node, out);
  }

  function processAttributes(node: Node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    const root = node as Element | Document;
    const els = root.querySelectorAll ? Array.from(root.querySelectorAll(ATTR_SELECTOR)) : [];
    if (root.nodeType === Node.ELEMENT_NODE && (root as Element).matches(ATTR_SELECTOR)) els.push(root as Element);
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

  // ------------------------------------------------------------ Queue

  function enqueue(node: Node, now?: boolean) {
    queue.push(node);
    if (!scheduled) {
      scheduled = true;
      if (now) flush();
      else if (typeof requestIdleCallback === 'function') requestIdleCallback(flush, { timeout: 300 });
      else setTimeout(flush, 50);
    }
  }

  /** Works in slices of SLICE_MS so that large pages don't stutter. */
  function flush() {
    scheduled = false;
    const start = performance.now();
    const timeUp = () => performance.now() - start > SLICE_MS;
    while (pendingPos < pending.length || queue.length) {
      if (pendingPos < pending.length) {
        // Checks the time only every 50 nodes, as performance.now() isn't free
        const end = Math.min(pendingPos + 50, pending.length);
        while (pendingPos < end) processTextNode(pending[pendingPos++]);
      } else {
        const root = queue.shift()!;
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
          if (written.get(m.target) !== (m.target as CharacterData).data) enqueue(m.target);
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
    Core.loadLexicon(globalThis.GENDER_LEXICON || '');
    enqueue(document.body || document.documentElement, true);
    observe();
  }

  // Injected before the page loads, so wait for the DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
