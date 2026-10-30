/*
 * Gendern zu Deutsch – core logic. Pure text processing, no DOM access.
 *
 * transform() steps:
 *   1. Remove soft hyphens inside gendered words
 *   2. Gendered nouns (Lehrer*innen, LehrerInnen, Lehrer(in) …) -> masculine form,
 *      via the Wiktionary lexicon; the case comes from the preceding article/preposition
 *   3. Article and pronoun pairs (der*die, ein*e, jede*r, sie/er …)
 *   4. Paired forms (Lehrerinnen und Lehrer)
 *   5. Participles (Studierende, Mitarbeitende)
 *   6. man/frau
 *   7. Custom replacements
 */
(function (root: typeof globalThis) {
  'use strict';

  /** Forms of a masculine noun; the nominative is masc. */
  type Entry = { masc: string; gen: string; dat: string; akk: string; pl: string; datPl: string };
  type Kasus = 'nom' | 'gen' | 'dat' | 'akk';
  type TextEdit = { start: number; end: number; text: string };
  type Context = { kasus: Kasus; edits?: TextEdit[] };
  type Word = { w: string; start: number; end?: number };
  type ScanResult = { text: string; before?: string } | null;

  // ---------------------------------------------------------------- Basics

  const SHY = '\\u00AD\\u200B\\u200C\\u200D\\u2060';
  const SHY_RE = new RegExp('[' + SHY + ']', 'g');
  const MARK = '[*:_/·•|⁎∗＊]';                 // gender marks
  const MARK_RE = new RegExp(MARK);
  const WB = '(?<![\\p{L}\\p{N}])';            // word start
  const WE = '(?![\\p{L}\\p{N}])';             // word end

  /** Makes the first letter of each word case-insensitive: "von" -> "[Vv]on". */
  function alt(words: string[]) {
    return '(?:' + words.map(w => '[' + w[0].toUpperCase() + w[0].toLowerCase() + ']' + w.slice(1)).join('|') + ')';
  }

  function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function capitalize(s: string) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function lowerFirst(s: string) {
    return s ? s[0].toLowerCase() + s.slice(1) : s;
  }

  function matchCase(word: string, model: string) {
    if (model.length > 1 && model === model.toUpperCase() && /\p{Lu}/u.test(model)) return word.toUpperCase();
    return /^\p{Lu}/u.test(model) ? capitalize(word) : word;
  }

  /**
   * Replaces all matches of the global regex re in text. fn(match, before) returns
   * null to keep the match (the search resumes at the next character, so
   * overlapping candidates aren't skipped), or { text, before? }, where before
   * rewrites the output preceding the match (e.g. "die" -> "der"). before is only
   * the tail of the output so far (at least CONTEXT_CHARS), keeping long texts linear.
   */
  const CONTEXT_CHARS = 160;
  function scan(text: string, re: RegExp, fn: (m: RegExpExecArray, before: string) => ScanResult) {
    re.lastIndex = 0;
    const parts: string[] = [];
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) {
        parts.push(text.slice(last, m.index));
        last = m.index;
      }
      let tail = '';
      let k = parts.length;
      while (k > 0 && tail.length < CONTEXT_CHARS) tail = parts[--k] + tail;
      const res = fn(m, tail);
      if (res == null) {
        re.lastIndex = m.index + 1;
        continue;
      }
      if (res.before != null && res.before !== tail) {
        parts.length = k;
        parts.push(res.before);
      }
      parts.push(res.text);
      last = m.index + m[0].length;
      re.lastIndex = last;
    }
    if (!parts.length) return text;
    parts.push(text.slice(last));
    return parts.join('');
  }

  // ---------------------------------------------------------------- Lexicon

  /** feminine singular -> entry */
  let femIndex = new Map<string, Entry>();
  /** masculine nominative singular -> entry */
  let mascIndex = new Map<string, Entry>();
  const femCache = new Map<string, Entry | null>();
  const mascCache = new Map<string, Entry | null>();

  // Additions and fixes missing from the Wiktionary export (e.g. words declined like adjectives)
  const OVERRIDES = [
    'Beamtin;Beamter;Beamten;Beamten;Beamten;Beamten;Beamten',
    'Chefin;Chef;+s;;;+s;+s',
    'Bäuerin;Bauer;+n;+n;+n;+n;+n',
    'Fan-in;Fan;+s;;;+s;+s',
    'Gästin;Gast;+es;;;Gäste;Gästen',
  ];

  function decodeForm(form: string | undefined, base: string) {
    if (!form) return base;
    return form[0] === '+' ? base + form.slice(1) : form;
  }

  function addLine(line: string) {
    const p = line.split(';');
    if (p.length < 2 || !p[1]) return;
    const masc = p[1];
    const fem = p[0] || masc + 'in';
    const entry = {
      masc,
      gen: decodeForm(p[2], masc),
      dat: decodeForm(p[3], masc),
      akk: decodeForm(p[4], masc),
      pl: decodeForm(p[5], masc),
      datPl: decodeForm(p[6], masc),
    };
    femIndex.set(fem, entry);
    if (!mascIndex.has(masc)) mascIndex.set(masc, entry);
  }

  function loadLexicon(data: string) {
    femIndex = new Map();
    mascIndex = new Map();
    femCache.clear();
    mascCache.clear();
    if (data) for (const line of data.split('\n')) addLine(line);
    for (const line of OVERRIDES) addLine(line);
    return femIndex.size;
  }

  function lexiconSize() {
    return femIndex.size;
  }

  function withPrefix(prefix: string, entry: Entry, lower: boolean): Entry {
    const f = (w: string) => prefix + (lower ? lowerFirst(w) : w);
    return {
      masc: f(entry.masc), gen: f(entry.gen), dat: f(entry.dat),
      akk: f(entry.akk), pl: f(entry.pl), datPl: f(entry.datPl),
    };
  }

  /** Looks up a word in an index, also as a compound (Grundschullehrerin, Nicht-Expertin). */
  function lookupCompound(word: string, index: Map<string, Entry>, cache: Map<string, Entry | null>, minTail: number): Entry | null {
    if (cache.has(word)) return cache.get(word)!;
    let res = index.get(word) || null;
    if (!res) {
      const h = word.lastIndexOf('-');
      if (h > 0 && h < word.length - 1) {
        const tail = lookupCompound(word.slice(h + 1), index, cache, minTail);
        if (tail) res = withPrefix(word.slice(0, h + 1), tail, false);
      } else {
        for (let i = 2; i <= word.length - minTail; i++) {
          const e = index.get(word[i].toUpperCase() + word.slice(i + 1));
          if (e) {
            res = withPrefix(word.slice(0, i), e, true);
            break;
          }
        }
      }
    }
    cache.set(word, res);
    return res;
  }

  const lookupFem = (w: string) => lookupCompound(w, femIndex, femCache, 5);
  const lookupMasc = (w: string) => lookupCompound(w, mascIndex, mascCache, 4);

  const UMLAUT: Record<string, string> = { a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' };

  /** Umlauts the last vowel (group): Arzt -> Ärzt, Bauer -> Bäuer, Koch -> Köch. */
  function umlautLast(stem: string) {
    const m = /(au|[aou])([^aeiouäöü]*e?[^aeiouäöü]*)$/i.exec(stem);
    if (!m) return null;
    const v = m[1][0];
    return stem.slice(0, m.index) + UMLAUT[v] + m[1].slice(1) + m[2];
  }

  /** Rough rules for words missing from the lexicon. */
  function heuristicEntry(stem: string): Entry {
    let m = stem;
    let weak = false;
    let pl;
    if (/(?:er|el)$/.test(m)) pl = m;                                       // Lehrer
    else if (/or$/.test(m)) pl = m + 'en';                                   // Autor
    else if (/(?:ent|ant|ist|at|graf|graph|nom|soph|naut|et)$/.test(m)) {   // Student, Polizist
      weak = true;
      pl = m + 'en';
    } else if (/(?:g|d|rt|it|e)$/.test(m)) {                                // Kollege, Kunde, Experte
      if (!m.endsWith('e')) m += 'e';
      weak = true;
      pl = m + 'n';
    } else pl = m + 'e';                                                     // Freund, Ingenieur
    const datPl = /[ns]$/.test(pl) ? pl : pl + 'n';
    if (weak) {
      const obl = m + (m.endsWith('e') ? 'n' : 'en');
      return { masc: m, gen: obl, dat: obl, akk: obl, pl, datPl };
    }
    return { masc: m, gen: m + (/[sßxz]$/.test(m) ? 'es' : 's'), dat: m, akk: m, pl, datPl };
  }

  const PERSON_SUFFIX = /(?:er|or|ent|ant|ist|eur|är|loge?|at|ot|ar|ier|ent)$/;
  const BINNEN_I_FALSE = new Set(['Plug', 'Log', 'Linked', 'Add', 'Check', 'Sign', 'Built', 'Walk', 'Opt', 'Sit',
    'Teach', 'Drive', 'Zoom', 'Dial', 'Fade', 'Join', 'Logg', 'Weig', 'Stay', 'Put', 'Cash', 'Plugg', 'Bundes']);

  /**
   * Finds the lexicon entry for the stem before a gender mark.
   * stem: "Lehrer", "Ärzt", "Kolleg", "Kollege", "Arzt", "Nicht-Expert" …
   * strict: only lexicon hits or typical person suffixes (for forms without a mark, like LehrerInnen)
   */
  function resolveStem(stem: string, strict: boolean) {
    const cands = [stem + 'in'];
    if (stem.endsWith('e')) cands.push(stem.slice(0, -1) + 'in');
    const u = umlautLast(stem);
    if (u && u !== stem) cands.push(u + 'in');
    for (const c of cands) {
      const e = lookupFem(c);
      if (e) return e;
    }
    if (stem.length < 3) return null;
    if (strict && (stem.length < 4 || !PERSON_SUFFIX.test(stem) || BINNEN_I_FALSE.has(stem))) return null;
    return heuristicEntry(stem);
  }

  function allForms(e: Entry) {
    return [e.masc, e.gen, e.dat, e.akk, e.pl, e.datPl];
  }

  // ---------------------------------------------------------------- Context (case and number)

  const DAT_PREP = new Set('aus außer bei beim mit mitsamt nach seit von vom zu zum zur gegenüber samt entgegen laut unter zwischen neben vor hinter nebst dank'.split(' '));
  const AKK_PREP = new Set('für gegen ohne durch um wider'.split(' '));
  const OTHER_PREP = new Set('an am auf in im über als wie wegen trotz während statt'.split(' '));
  const DER_STEM = '(?:jed|dies|jen|welch|manch|solch)';
  const EIN_STEM = '(?:ein|kein|mein|dein|sein|ihr|unser|eur|euer)';
  const QUANT_EN = new Set('vielen einigen wenigen beiden mehreren sämtlichen zahlreichen etlichen verschiedenen anderen weiteren'.split(' '));
  const ADJ_STOP = new Set('über unter hinter wieder oder aber immer außer gegen entgegen neben oben unten eben sehr bitte gerne heute morgen'.split(' '));

  const RE_DAT = new RegExp('^(?:dem|' + DER_STEM + 'em|' + EIN_STEM + 'em)$');
  const RE_EN = new RegExp('^(?:den|' + DER_STEM + 'en|' + EIN_STEM + 'en|allen)$');
  const RE_GEN = new RegExp('^(?:des|' + DER_STEM + 'es|' + EIN_STEM + 'es)$');
  const RE_FEM_E = new RegExp('^(' + EIN_STEM + ')e$');           // eine, keine, meine
  const RE_FEM_ER = new RegExp('^(' + EIN_STEM + ')er$');         // einer, keiner (feminine dative/genitive)
  const RE_DER_E = new RegExp('^(' + DER_STEM + ')e$');           // jede, diese
  const RE_DER_ER = new RegExp('^' + DER_STEM + 'er$');           // jeder, dieser
  const RE_EIN = new RegExp('^' + EIN_STEM + '$');
  const RE_ADJ = new RegExp('^\\p{Ll}+e(?:' + MARK + '-?|\\()?(?:[rnms]|n|en)?\\)?$', 'u');
  const RE_EINE_R = new RegExp('^(?:[KkMmDdSs]?[Ee]in|[Ii]hr|[Uu]nser|[Ee]ur|[Kk]ein)e(?:' + MARK + '-?|\\()r\\)?$', 'u');
  const RE_PLURAL_DET =/^(?:die|alle|viele|einige|wenige|beide|mehrere|keine|meine|deine|seine|ihre|unsere|eure|diese|jene|welche|solche|manche)$/;

  /** The last words before a position, with their start index, last word first. Stops at punctuation. */
  function wordsBefore(before: string, max: number) {
    const from = Math.max(0, before.length - 120);
    const tail = before.slice(from);
    const re = /\S+/g;
    const words: Word[] = [];
    let m;
    while ((m = re.exec(tail))) words.push({ w: m[0], start: from + m.index });
    const res: Word[] = [];
    for (let i = words.length - 1; i >= 0 && res.length < max; i--) {
      const raw = words[i].w;
      if (/[.!?;:,–—"“”„»«\]]$/.test(raw) && !/^(?:bzw|z\.B|u\.a|ca|Dr|Prof)\.$/.test(raw)) break;
      const lead = /^[("„“»«[\-]+/.exec(raw);
      const w = lead ? raw.slice(lead[0].length) : raw;
      if (!w) break;
      res.push({ w, start: words[i].start + (lead ? lead[0].length : 0), end: words[i].start + raw.length });
      if (lead) break;
    }
    // No context if the match isn't preceded by whitespace (e.g. "(")
    if (before && !/\s$/.test(before)) return [];
    return res;
  }

  function isMarked(w: string) {
    return /[*:_/·•|⁎∗＊()]/.test(w) || /\p{Ll}[RNMSE]$/u.test(w);
  }

  /**
   * Determines a noun's case from the words before it. edits rewrite a purely
   * feminine article (and adjectives) before it to the masculine form.
   */
  function analyseContext(before: string, plural: boolean): Context {
    const words = wordsBefore(before, 6);
    const adjectives: Word[] = [];
    let sawQuant = false;
    for (let i = 0; i < words.length; i++) {
      const raw = words[i].w;
      const w = raw.toLowerCase();
      if (/^\d[\d.,]*$/.test(w)) continue;
      if (!plural && RE_EINE_R.test(raw)) {
        // "mit eine*r Ärzt*in": before a noun this is the dative (einer/einem)
        const stem = raw.slice(0, raw.search(/e(?:[^\p{L}]+)r\)?$/u));
        return { kasus: 'dat', edits: [{ start: words[i].start, end: words[i].start + raw.length, text: stem + 'em' }] };
      }
      if (isMarked(raw)) {
        // Gendered article (der*die, eine*n): its masculine reading gives the case
        const n = normalizeArticles(raw, { binnenI: 0 }).toLowerCase();
        if (isDet(n)) return { kasus: caseOfMasc(n, plural) };
      }
      if (RE_DAT.test(w)) return { kasus: 'dat' };
      if (RE_EN.test(w)) return { kasus: plural ? 'dat' : 'akk' };
      if (RE_GEN.test(w)) return { kasus: 'gen' };
      if (plural) {
        if (RE_PLURAL_DET.test(w) || w === 'der') return { kasus: 'nom' };
      } else {
        if (w === 'der' || RE_FEM_ER.test(w)) return femContext(words, i, adjectives, w === 'der' ? 'der' : 'einer');
        if (w === 'die' || RE_FEM_E.test(w) || RE_DER_E.test(w)) return femContext(words, i, adjectives, w === 'die' ? 'die' : RE_FEM_E.test(w) ? 'eine' : 'jede');
        if (RE_DER_ER.test(w) || RE_EIN.test(w) || w === 'das') return { kasus: 'nom' };
      }
      if (DAT_PREP.has(w)) return { kasus: 'dat' };
      if (AKK_PREP.has(w)) return { kasus: plural ? 'nom' : 'akk' };
      if (OTHER_PREP.has(w)) return { kasus: 'nom' };
      if (QUANT_EN.has(w)) { sawQuant = true; adjectives.push(words[i]); continue; }
      if (RE_ADJ.test(raw) && !ADJ_STOP.has(w) && /^\p{Ll}/u.test(raw)) { adjectives.push(words[i]); continue; }
      break;
    }
    return { kasus: plural && sawQuant ? 'dat' : 'nom' };
  }

  function isDet(w: string) {
    return /^(?:der|die|das|den|dem|des)$/.test(w) || RE_DAT.test(w) || RE_EN.test(w) || RE_GEN.test(w) ||
      RE_FEM_E.test(w) || RE_FEM_ER.test(w) || RE_DER_E.test(w) || RE_DER_ER.test(w) || RE_EIN.test(w) || RE_PLURAL_DET.test(w);
  }

  /** The first article before a position, skipping adjectives and numbers, or ''. */
  function firstDet(before: string) {
    for (const { w: raw } of wordsBefore(before, 4)) {
      const w = raw.toLowerCase();
      if (isDet(w)) return w;
      if (/^\d[\d.,]*$/.test(w) || (RE_ADJ.test(raw) && !ADJ_STOP.has(w))) continue;
      return '';
    }
    return '';
  }

  function caseOfMasc(n: string, plural: boolean): Kasus {
    if (plural) return /^(?:den|\p{L}+en)$/u.test(n) && n !== 'ein' ? 'dat' : 'nom';
    if (/em$/.test(n)) return 'dat';
    if (/es$/.test(n)) return 'gen';
    if (/en$/.test(n)) return 'akk';
    return 'nom';
  }

  /** Purely feminine article before a singular ("die Lehrer*in"): guesses the case and rewrites the article. */
  function femContext(words: Word[], i: number, adjectives: Word[], type: 'der' | 'die' | 'eine' | 'einer' | 'jede'): Context {
    const det = words[i];
    const prev = words[i + 1] ? words[i + 1].w : '';
    const prevLower = prev.toLowerCase();
    let kasus: Kasus;
    if (type === 'die' || type === 'eine' || type === 'jede') {
      kasus = AKK_PREP.has(prevLower) ? 'akk' : 'nom';
    } else if (type === 'einer') {
      // The genitive almost always follows a noun ("die Aufgabe einer Lehrer*in")
      kasus = !DAT_PREP.has(prevLower) && /^\p{Lu}/u.test(prev) ? 'gen' : 'dat';
    } else { // "der": masculine nominative or feminine dative/genitive
      if (DAT_PREP.has(prevLower)) kasus = 'dat';
      else if (/^\p{Lu}/u.test(prev) && /^\p{Ll}/u.test(det.w)) kasus = 'gen';
      else return { kasus: 'nom' };
    }
    const lw = det.w.toLowerCase();
    let masc;
    if (type === 'die') masc = kasus === 'akk' ? 'den' : 'der';
    else if (type === 'der') masc = kasus === 'dat' ? 'dem' : 'des';
    else if (type === 'eine') masc = lw.slice(0, -1) + (kasus === 'akk' ? 'en' : '');
    else if (type === 'einer') masc = lw.slice(0, -2) + (kasus === 'dat' ? 'em' : 'es');
    else masc = lw.slice(0, -1) + (kasus === 'akk' ? 'en' : 'er');
    const edits = [{ start: det.start, end: det.start + det.w.length, text: matchCase(masc, det.w) }];
    for (const a of adjectives) {
      if (!/^\p{Ll}+e$/u.test(a.w)) continue;
      let ending: string | null = null;
      if (kasus === 'akk' || kasus === 'dat' || kasus === 'gen') ending = 'en';
      else if (type === 'eine') ending = 'er';
      if (ending) edits.push({ start: a.start, end: a.start + a.w.length, text: a.w.slice(0, -1) + ending });
    }
    return { kasus, edits };
  }

  function applyEdits(text: string, edits: TextEdit[] | undefined) {
    if (!edits) return text;
    for (const e of edits.slice().sort((a, b) => b.start - a.start)) {
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    }
    return text;
  }

  function formFor(entry: Entry, plural: boolean, kasus: Kasus) {
    if (plural) return kasus === 'dat' ? entry.datPl : entry.pl;
    return entry[kasus === 'nom' ? 'masc' : kasus] || entry.masc;
  }

  // ---------------------------------------------------------------- 2. Gendered nouns

  const NOUN_RE = new RegExp(
    '(?<![\\p{L}\\p{N}@/\\\\._:-])' +
    '(\\p{Lu}[\\p{L}' + SHY + '-]*?\\p{L})' +                        // 1 stem
    '(?:' +
      '(' + MARK + '-?|\\.)(innen|in|Innen|In|INNEN|IN)' +           // 2,3 Lehrer*innen, Lehrer.in
      '|\\((innen|in|Innen|In|INNEN|IN)\\)' +                         // 4   Lehrer(innen)
      '|\\((inn|Inn)\\)en|\\((in|In)\\)nen' +                         // 5,6 Lehrer(inn)en, Lehrer(in)nen
      '|(Innen|In)' +                                                  // 7   LehrerInnen
      '|(ïnnen|ïn|ÏNNEN|ÏN)' +                                         // 8   Lehrerïnnen
      '|\\*(nnen)' +                                                   // 9   Lehrer*nnen
    ')' +
    '(\\p{Ll}*)' +                                                     // 10  rest of a compound
    WE,
    'gu');

  function transformNouns(text: string, counts: GzDCounts, ctx: GzDCompiledOptions) {
    return scan(text, NOUN_RE, (m, before) => {
      const rawStem = m[1];
      const stem = rawStem.replace(SHY_RE, '');
      const suffix = m[3] || m[4] || m[5] || m[6] || m[7] || m[8] || m[9] || '';
      const binnenI = !!m[7];
      const tail = m[10];
      if (binnenI && !/\p{Ll}$/u.test(stem)) return null;
      if (m[2] === '.' && !/\p{Ll}$/u.test(stem)) return null;
      const plural = /nn/i.test(suffix) || !!m[5] || !!m[6];
      if (tail && !plural) return null;
      if (ctx.isException(m[0])) return null;

      const allCaps = !/\p{Ll}/u.test(stem);
      // Without an unambiguous mark (LehrerInnen, Lehrer.innen, compounds), only replace lexicon hits
      // or typical person suffixes, to avoid false hits like "LinkedIn" or "Österreich.in".
      // "_", "/", "|" and "." also appear in identifiers, paths and addresses.
      const strict = binnenI || !!tail || (!!m[2] && /^[._/|]/.test(m[2]));
      const entry = resolveStem(allCaps ? capitalize(stem.toLowerCase()) : stem, strict);
      if (!entry) return null;
      let word;
      let newBefore;
      if (tail) {
        word = entry.pl + tail;
      } else {
        const c = analyseContext(before, plural);
        word = formFor(entry, plural, c.kasus);
        newBefore = applyEdits(before, c.edits);
      }
      if (allCaps) word = word.toUpperCase();
      counts.binnenI++;
      return { text: word, before: newBefore };
    });
  }

  // ---------------------------------------------------------------- 3. Articles and pronouns

  const PAIR_MAP = new Map<string, string>();
  function pair(fem: string, masc: string) {
    PAIR_MAP.set(fem + '|' + masc, masc);
    PAIR_MAP.set(masc + '|' + fem, masc);
  }
  [['die', 'der'], ['die', 'den'], ['der', 'des'], ['der', 'dem'], ['deren', 'dessen'],
    ['sie', 'er'], ['ihr', 'ihm'], ['sie', 'ihn'], ['ihr', 'sein'], ['ihre', 'sein'],
    ['diejenige', 'derjenige'], ['derjenigen', 'desjenigen'], ['derjenigen', 'demjenigen'], ['diejenige', 'denjenigen'],
  ].forEach(p => pair(p[0], p[1]));
  for (const s of ['jed', 'dies', 'jen', 'welch', 'solch', 'manch']) {
    pair(s + 'e', s + 'er'); pair(s + 'e', s + 'en'); pair(s + 'er', s + 'es'); pair(s + 'er', s + 'em');
  }
  for (const s of ['ein', 'kein', 'mein', 'dein', 'sein', 'unser', 'euer']) {
    const t = s === 'euer' ? 'eur' : s;
    pair(t + 'e', s); pair(t + 'e', t + 'en'); pair(t + 'er', t + 'es'); pair(t + 'er', t + 'em');
  }
  for (const end of ['e', 'en', 'em', 'er', 'es']) pair('ihr' + end, 'sein' + end);

  const PAIR_RE = new RegExp(WB + '(\\p{L}+)(' + MARK + '-?|\\s?/\\s?| oder | bzw\\.? )(\\p{L}+)' + WE, 'gu');

  // Endings: jede*r, eine*n, jedem*r, einer*s, ein*e, jede(r), jedeR …
  const SUFFIX_RULES: [RegExp, string | ((m: string, a: string, b: string) => string)][] = [
    [new RegExp(WB + '((?:[KkMmDdSs]?[Ee]in|[Ii]hr|[Uu]nser|[Ee]ue?r))(?:' + MARK + '-?e|\\(e\\)|E)' + WE, 'gu'), '$1'], // ein*e -> ein
    [new RegExp(WB + '(\\p{L}+e)m(?:' + MARK + '-?|\\()r\\)?' + WE, 'gu'), '$1m'],                     // jedem*r -> jedem
    [new RegExp(WB + '(\\p{L}+e)r(?:' + MARK + '-?|\\()m\\)?' + WE, 'gu'), '$1m'],                     // jeder*m -> jedem
    [new RegExp(WB + '(\\p{L}+e)s(?:' + MARK + '-?|\\()r\\)?' + WE, 'gu'), '$1s'],                     // jedes*r -> jedes
    [new RegExp(WB + '(\\p{L}+e)r(?:' + MARK + '-?|\\()s\\)?' + WE, 'gu'), '$1s'],                     // einer*s -> eines
    [new RegExp(WB + '(\\p{L}+e)(?:' + MARK + '-?|\\()(r|m|s)\\)?' + WE, 'gu'), '$1$2'],              // jede*r -> jeder
    [new RegExp(WB + '(\\p{L}+e)(?:[*:_·•|⁎∗＊]-?)n' + WE, 'gu'), '$1n'],                              // eine*n -> einen
    [new RegExp(WB + '(\\p{Ll}+e)(?:/-?|\\()n\\)?' + WE, 'gu'), '$1n'],                                // eine/n -> einen (lowercase only, not "Seite(n)")
    [new RegExp(WB + '(\\p{Ll}+e)([RNMS])' + WE, 'gu'), (m, a, b) => a + b.toLowerCase()],             // jedeR -> jeder
  ];

  function normalizeArticles(text: string, counts: Pick<GzDCounts, 'binnenI'>) {
    text = scan(text, PAIR_RE, m => {
      const masc = PAIR_MAP.get(m[1].toLowerCase() + '|' + m[3].toLowerCase());
      if (!masc) return null;
      counts.binnenI++;
      return { text: matchCase(masc, m[1]) };
    });
    for (const [re, rep] of SUFFIX_RULES) {
      text = text.replace(re, (...args: string[]) => {
        counts.binnenI++;
        return typeof rep === 'function' ? rep(args[0], args[1], args[2]) : rep.replace(/\$(\d)/g, (_, n: string) => args[Number(n)]);
      });
    }
    return text;
  }

  // ---------------------------------------------------------------- 4. Paired forms

  const PREP_W = alt('von vom für mit bei beim zu zum zur aus an am auf als nach über unter gegen ohne durch um zwischen neben vor hinter seit wegen trotz gegenüber'.split(' '));
  const DET_W = alt(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
    'kein', 'keine', 'keiner', 'keinem', 'keinen', 'keines', 'ihre', 'ihren', 'ihrer', 'ihrem', 'ihr',
    'unsere', 'unseren', 'unserer', 'unserem', 'unser', 'eure', 'euren', 'jede', 'jeder', 'jedem', 'jeden', 'jedes',
    'alle', 'allen', 'aller', 'diese', 'dieser', 'diesem', 'diesen', 'dieses', 'viele', 'vielen', 'einige', 'einigen', 'beide', 'beiden']);
  // An adjective before the first word may be capitalized (sentence start: "Liebe Kolleginnen"),
  // before the second not, or a noun would be taken for an adjective.
  const ADJ_W = (first: boolean) => '(?!(?:' + Array.from(ADJ_STOP).join('|') + ')\\s)' + (first ? '\\p{L}' : '\\p{Ll}') + '\\p{Ll}*(?:e|en|er|es|em)';
  const PREFIX = (n: number) => '(' + PREP_W + '\\s+)?(' + DET_W + '\\s+)?(' + ADJ_W(n === 1) + '\\s+)?';
  const DOPPEL_RE = new RegExp(
    WB + PREFIX(1) + '(\\p{Lu}[\\p{L}-]*)' +
    '( und | oder | bzw\\.? | & |, | sowie | als auch | wie auch |\\s?/\\s?)' +
    PREFIX(2) + '(-\\p{Ll}[\\p{L}-]*|\\p{Lu}[\\p{L}-]*)' + WE,
    'gu');
  const GENDER_ADJ = /(?:^|\s)(?:männlich|weiblich|divers|nichtbinär|nicht-binär|transgeschlechtlich|trans)\p{Ll}*\s/iu;
  const DOPPEL_HINT =/\p{Ll}in(?:nen)?(?![\p{L}\p{N}])|(\p{Lu}\p{L}+) (?:und|oder|bzw\.?) \1(?![\p{L}])/u;

  /** The lexicon entry for a full feminine form (Lehrerin, Lehrerinnen), or null. */
  function femWord(word: string) {
    let stem;
    if (word.endsWith('innen')) stem = word.slice(0, -5);
    else if (word.endsWith('in')) stem = word.slice(0, -2);
    else return null;
    if (stem.length < 2) return null;
    return lookupFem(stem + 'in') || (stem.length >= 3 ? heuristicEntry(stem) : null);
  }

  function matchForm(entry: Entry, word: string) {
    if (word.startsWith('-')) {
      const tail = word.slice(1).toLowerCase();
      return allForms(entry).find(f => f.length > tail.length + 1 && f.toLowerCase().endsWith(tail)) || null;
    }
    return allForms(entry).includes(word) ? word : null;
  }

  function transformDoppelformen(text: string, counts: GzDCounts, ctx: GzDCompiledOptions) {
    if (!DOPPEL_HINT.test(text)) return text;
    return scan(text, DOPPEL_RE, (m, before) => {
      const [all, prep1 = '', det1 = '', adj1 = '', w1, conj, prep2 = '', det2 = '', adj2 = '', w2] = m;
      if (ctx.isException(all)) return null;
      // "Wählerinnen und männliche Wähler" distinguishes on purpose; keep it
      if (GENDER_ADJ.test(adj1 + adj2)) return null;
      // "sowohl … als auch …": the "sowohl" is removed too; "als auch" without "sowohl" is no pair
      let newBefore: string | undefined;
      if (conj === ' als auch ' || conj === ' wie auch ') {
        const sowohl = /(^|\s)[Ss]owohl $/.exec(before);
        if (!sowohl) return null;
        newBefore = before.slice(0, sowohl.index + sowohl[1].length);
      }
      const done = (text: string) => {
        counts.doppelformen++;
        if (newBefore != null && before[newBefore.length] === 'S') text = capitalize(text); // "Sowohl …" at sentence start
        return { text, before: newBefore };
      };
      // Merges leftovers like "Wähler und Wähler" (from "Wähler*innen und Wähler")
      if (w1 === w2 && !prep2 && !det2 && !adj2 && /und|oder|bzw|&|\//.test(conj)) {
        return done(prep1 + det1 + adj1 + w1);
      }
      // Feminine first: "die Lehrerin und der Lehrer", "Bürgervertreterinnen und -vertreter"
      let fem = femWord(w1);
      if (fem) {
        const masc = matchForm(fem, w2);
        if (masc && masc !== w1) {
          let out = (prep2 || prep1) + (det2 || adj2 ? det2 + adj2 : det1 + adj1) + masc;
          if ((prep1 || det1 || adj1) && /^\p{Lu}/u.test(all)) out = capitalize(out);
          return done(out);
        }
      }
      // Masculine first: "Lehrer und Lehrerinnen", "Bürgervertreter und -vertreterinnen"
      const femTail = w2.startsWith('-') ? capitalize(w2.slice(1)) : w2;
      fem = femWord(femTail);
      if (fem) {
        const ok = w2.startsWith('-')
          ? allForms(fem).some(f => w1.toLowerCase().endsWith(f.toLowerCase()))
          : allForms(fem).includes(w1);
        if (ok) return done(prep1 + det1 + adj1 + w1);
      }
      return null;
    });
  }

  // ---------------------------------------------------------------- 5. Participles

  const PARTIZIP_TABLE: Record<string, string> = {
    Studier: 'Student', Dozier: 'Dozent', Assistier: 'Assistent', Promovier: 'Doktorand',
    Kunstschaff: 'Künstler', Musikschaff: 'Musiker', Zufußgeh: 'Fußgänger', Fußgeh: 'Fußgänger',
    Lern: 'Lerner', Geflüchtet: 'Flüchtling',
  };
  const PARTIZIP_KEEP = new Set(['Vorsitz', 'Reis', 'Alleinerzieh', 'Auszubild', 'Anwes', 'Abwes', 'Überleb',
    'Sterb', 'Leid', 'Führ', 'Folg', 'Leb', 'Kulturschaff', 'Hinterblieb', 'Notleid', 'Pflegebedürft',
    'Vorsteh', 'Betreff', 'Entsprech', 'Nachsteh', 'Vorangeh', 'Ausreich']);
  const PARTIZIP_RE = new RegExp(
    WB + '(\\p{Lu}[\\p{L}-]*?)(end|et)(e|en|er|em|es)(?:(' + MARK + '-?|\\()(r|n|m|s)\\)?)?' + WE + '(?!\\s+\\p{Lu})',
    'gu');

  function participleEntry(stem: string, kind: string) {
    if (PARTIZIP_KEEP.has(stem)) return null;
    if (kind === 'et') {
      const t = PARTIZIP_TABLE[stem + 'et'];
      return t ? lookupMasc(t) || heuristicEntry(t) : null;
    }
    if (PARTIZIP_TABLE[stem]) {
      const t = PARTIZIP_TABLE[stem];
      return lookupMasc(t) || heuristicEntry(t);
    }
    return lookupMasc(stem + 'er');
  }

  const GEN_PL_QUANT = new Set('aller beider vieler einiger weniger mehrerer zahlreicher etlicher sämtlicher verschiedener anderer weiterer'.split(' '));

  /**
   * Whether "-er" without an article is genitive plural ("Anteil ausländischer Studierender",
   * "die Zahl vieler Studierender") rather than nominative singular ("als Studierender").
   */
  function isGenPluralEr(before: string) {
    for (const { w: raw } of wordsBefore(before, 6)) {
      const w = raw.toLowerCase();
      if (/^\d[\d.,]*$/.test(w)) continue;
      if (GEN_PL_QUANT.has(w)) return true;
      if (RE_ADJ.test(raw) && !ADJ_STOP.has(w) && /^\p{Ll}/u.test(raw)) continue;
      // Directly after a noun ("Anteil", "Zahl") it is genitive; capitalized adjectives or
      // articles at sentence start ("Ausländischer Studierender sucht") don't count
      return /^\p{Lu}\p{Ll}/u.test(raw) && !RE_ADJ.test(w) && !isDet(w) &&
        !DAT_PREP.has(w) && !AKK_PREP.has(w) && !OTHER_PREP.has(w);
    }
    return false;
  }

  function transformPartizip(text: string, counts: GzDCounts, ctx: GzDCompiledOptions) {
    return scan(text, PARTIZIP_RE, (m, before) => {
      const [all, stem, kind, end, , star] = m;
      if (ctx.isException(all)) return null;
      const entry = participleEntry(stem, kind);
      if (!entry) return null;
      let plural: boolean;
      let kasus: Kasus;
      let edits: TextEdit[] | undefined;
      if (star) {
        plural = false;
        kasus = ({ r: 'nom', n: 'akk', m: 'dat', s: 'gen' } as const)[star as 'r' | 'n' | 'm' | 's'];
      } else if (end === 'er') {
        if (!RE_EIN.test(firstDet(before)) && isGenPluralEr(before)) { plural = true; kasus = 'gen'; }
        else { plural = false; kasus = 'nom'; }
      }
      else if (end === 'em') { plural = false; kasus = 'dat'; }
      else if (end === 'es') { plural = false; kasus = 'gen'; }
      else {
        const det = firstDet(before);
        if (det === 'das') return null; // "das Vorstehende" is not a person
        if (end === 'e') {
          if (det === 'der' || RE_DER_ER.test(det)) { plural = false; kasus = 'nom'; }
          else if (det === 'die' || det === 'eine' || RE_DER_E.test(det)) {
            // "die Studierende" (one female student) -> "der Student"
            plural = false;
            const c = analyseContext(before, false);
            kasus = c.kasus;
            edits = c.edits;
          } else { plural = true; kasus = 'nom'; }
        } else { // -en
          if (det === 'einen') { plural = false; kasus = 'akk'; }
          else if (RE_DAT.test(det)) { plural = false; kasus = 'dat'; }
          else if (RE_GEN.test(det)) { plural = false; kasus = 'gen'; }
          else if (det === 'einer') { plural = false; const c = analyseContext(before, false); kasus = c.kasus; edits = c.edits; }
          else { plural = true; kasus = analyseContext(before, true).kasus; }
        }
      }
      counts.partizip++;
      return { text: formFor(entry, plural, kasus), before: edits ? applyEdits(before, edits) : undefined };
    });
  }

  // ---------------------------------------------------------------- 6. man/frau

  const MAN_RE = new RegExp('(?<![\\p{L}\\p{N}./@_-])(?:frau|mann?|mensch)(?:[*:_/·•|()-]+| oder | bzw\\.? )(?:frau|mann?|mensch)\\)?' + WE, 'gu');
  const FRAU_RE = new RegExp('(?<![\\p{L}\\p{N}./@_-])frau(?![\\p{L}\\p{N}@_/-])', 'gu');
  const JEMENSCH_RE = new RegExp(WB + '([Jj]e|[Nn]ie)mensch' + WE, 'gu');

  function transformMan(text: string, counts: GzDCounts) {
    if (!/frau|mensch/.test(text)) return text;
    text = text.replace(MAN_RE, () => { counts.binnenI++; return 'man'; });
    text = text.replace(FRAU_RE, () => { counts.binnenI++; return 'man'; });
    text = text.replace(JEMENSCH_RE, (m, p: string) => { counts.binnenI++; return p + 'mand'; });
    return text;
  }

  // ---------------------------------------------------------------- Soft hyphens

  const SHY_WORD_RE = new RegExp('[\\p{L}' + SHY + '*:_/·•|().-]*[' + SHY + '][\\p{L}' + SHY + '*:_/·•|().-]*', 'gu');
  const GENDERISH = new RegExp('\\p{Ll}(?:' + MARK + '-?|\\(|\\.)?(?:[Ii]nn?|ïn)|\\p{Ll}in(?:nen)?$', 'u');

  function stripSoftHyphens(text: string) {
    if (!SHY_RE.test(text)) return text;
    SHY_RE.lastIndex = 0;
    return text.replace(SHY_WORD_RE, w => {
      const clean = w.replace(SHY_RE, '');
      return GENDERISH.test(clean) ? clean : w;
    });
  }

  // ---------------------------------------------------------------- Public API

  const QUICK = new RegExp('[*:_/·•|⁎∗＊()ïÏ]|\\p{Ll}I|\\p{Ll}\\.?in(?:nen)?' + WE + '|ende|frau|mensch| oder | bzw', 'u');

  /** Parses custom replacements: one "from => to" or "from = to" per line. */
  function parseCustom(str: unknown) {
    return String(str || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/\s*=>?\s*/)).filter(p => p.length === 2 && p[0]);
  }

  function parseList(str: unknown) {
    return String(str || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  }

  function compileOptions(opts?: GzDOptions | null): GzDCompiledOptions {
    const cached = opts && (opts as { _compiled?: GzDCompiledOptions })._compiled;
    if (cached) return cached;
    const o = Object.assign({ doppelformen: true, partizip: false, eigene: '', ausnahmen: '' }, opts);
    const exceptions = parseList(o.ausnahmen);
    const exRe = exceptions.length ? new RegExp(exceptions.map(escapeRe).join('|'), 'u') : null;
    const custom = parseCustom(o.eigene).map(([from, to]): [RegExp, string] => [new RegExp(WB + escapeRe(from) + WE, 'gu'), to]);
    const compiled = {
      doppelformen: !!o.doppelformen,
      partizip: !!o.partizip,
      custom,
      isException: (s: string) => !!exRe && exRe.test(s),
    };
    if (opts) Object.defineProperty(opts, '_compiled', { value: compiled, enumerable: false, configurable: true });
    return compiled;
  }

  function transform(text: string, opts?: GzDOptions | null): GzDResult {
    const counts = { binnenI: 0, doppelformen: 0, partizip: 0 };
    const ctx = compileOptions(opts);
    let s = text;
    if (QUICK.test(s)) {
      s = stripSoftHyphens(s);
      s = transformNouns(s, counts, ctx);
      s = normalizeArticles(s, counts);
      if (ctx.doppelformen) s = transformDoppelformen(s, counts, ctx);
      if (ctx.partizip) s = transformPartizip(s, counts, ctx);
      s = transformMan(s, counts);
    }
    for (const [re, to] of ctx.custom) {
      s = s.replace(re, () => { counts.binnenI++; return to; });
    }
    if (s === text) {
      counts.binnenI = counts.doppelformen = counts.partizip = 0;
    }
    return { text: s, counts };
  }

  const api = { transform, loadLexicon, lexiconSize, parseList, parseCustom, compileOptions };
  root.GenderCore = api;
})(globalThis);
