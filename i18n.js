/**
 * ====================================================================
 * MoneyFlow — the page in English, Bahasa Melayu or 中文
 * --------------------------------------------------------------------
 * app.js writes every word on screen in English, and it keeps doing so:
 * fifteen thousand lines of it build their sentences out of figures, names
 * and dates as the user types, and threading a translation call through
 * every one of them would be a rewrite with a bug in every other line.
 *
 * So the translating happens one step later, on the page itself. Each piece
 * of text that lands on screen is looked up in the dictionary for the
 * language picked — lang/ms.js, lang/zh.js, keyed by the English — and
 * swapped for its translation. A MutationObserver does it for everything
 * app.js draws afterwards, so a screen redrawn on every keystroke stays in
 * the reader's language without app.js knowing there is more than one.
 *
 * Three kinds of entry, tried in this order:
 *
 *   "Add item"                    the whole text, word for word
 *   "Saved {0}"                   a sentence with figures in it — {0} takes
 *                                 whatever is there ("Saved 2 Nov"), and is
 *                                 itself translated before it goes back in
 *   dates                         "2 Nov", "Aug 2026", "Monday, 2 November",
 *                                 written the way each language writes them
 *
 * Anything with no entry stays in English. That is the failure mode on
 * purpose: a sentence app.js changes tomorrow shows up in English until the
 * dictionary catches up, rather than as a blank or a broken screen.
 * `MFI18n.missing()` in the console lists what is on screen untranslated.
 *
 * What it never touches: anything typed into a field (inputs keep their
 * values), and anything inside translate="no" — the language names in the
 * picker, which are written in their own language whatever is chosen.
 * ====================================================================
 */
(function () {
    'use strict';

    var KEY = 'moneyflow.lang';

    /** The languages on offer, by the code `<html lang>` and the files use. */
    var LANGS = {
        en: { name: 'English',       html: 'en' },
        ms: { name: 'Bahasa Melayu', html: 'ms' },
        zh: { name: '中文',           html: 'zh-Hans' },
    };

    /** The attributes that carry words: tooltips, hints, and what a screen reader says. */
    var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

    /** Elements whose text is not ours to change. */
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

    var EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                    'September', 'October', 'November', 'December'];
    var EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var EN_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var MON_RE = EN_MON.join('|');
    var DATE_RULES = [
        // "2 Nov", "2 Nov 2026"
        { re: new RegExp('^(\\d{1,2}) (' + MON_RE + ')(?: (\\d{4}))?$'),
          out: function (f, m) { return fill(m[3] ? f.dmy : f.dm, { d: m[1], m: m[2], y: m[3] }); } },
        // "Nov 2026"
        { re: new RegExp('^(' + MON_RE + ') (\\d{4})$'),
          out: function (f, m) { return fill(f.my, { m: m[1], y: m[2] }); } },
        // "Nov '26" — the axis of a chart that crosses a year
        { re: new RegExp('^(' + MON_RE + ") '(\\d{2})$"),
          out: function (f, m) { return fill(f.mys || f.my, { m: m[1], y: m[2] }); } },
        // "Monday, 2 November" — the date over a screen's name on a phone
        { re: new RegExp('^(' + EN_WEEKDAY.join('|') + '),? (\\d{1,2}) (' + EN_MONTH.join('|') + ')$'),
          out: function (f, m) { return fill(f.long, { W: m[1], d: m[2], M: m[3] }); } },
    ];

    /* ------------------------------------------------------------------ *
     * The dictionaries
     * ------------------------------------------------------------------ */

    var dicts = Object.create(null);   // code -> compiled dictionary
    var loading = Object.create(null); // code -> true while its file is on the way

    var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
    var escapeRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

    var dict = null; // the compiled dictionary of the language on screen, or null for English

    function fill(format, parts) {
        return format.replace(/\{(\w)\}/g, function (all, k) {
            var cal = dict.cal;
            if (k === 'm') return cal.mon[EN_MON.indexOf(parts.m)];
            if (k === 'M') return cal.month[EN_MONTH.indexOf(parts.M)];
            if (k === 'W') return cal.weekday[EN_WEEKDAY.indexOf(parts.W)];
            return parts[k] === undefined ? '' : parts[k];
        });
    }

    /**
     * Called by each lang/*.js file. `strings` is { English: translation };
     * `cal` is how that language writes month and day names and dates.
     */
    function add(code, strings, cal) {
        if (!LANGS[code] || code === 'en') return;
        var d = dicts[code] || (dicts[code] = { exact: new Map(), back: new Map(), templates: [], cache: new Map(), cal: null, punct: {} });

        if (cal) {
            d.cal = cal;
            d.punct = cal.punct || {};
            // Month and day names alone — "Aug" on a chart axis, "Mon" in a calendar.
            var pairs = [[EN_MON, cal.mon], [EN_MONTH, cal.month], [EN_DAY, cal.day], [EN_WEEKDAY, cal.weekday]];
            pairs.forEach(function (pair) {
                pair[0].forEach(function (en, i) {
                    if (pair[1] && pair[1][i] && !d.exact.has(en)) d.exact.set(en, pair[1][i]);
                });
            });
        }

        Object.keys(strings).forEach(function (raw) {
            var out = strings[raw];
            if (typeof out !== 'string' || !out) return;
            var en = norm(raw);
            if (en.indexOf('{0}') === -1) {
                d.exact.set(en, out);
                // Two English phrases can share a translation ("Dashboard" and
                // "The dashboard" are both "Papan Pemuka"). The first one wins
                // the way back: the files list index.html first, and the
                // labels app.js copies off the page are the ones in there.
                if (!d.back.has(norm(out))) d.back.set(norm(out), en);
                return;
            }
            // A sentence with holes in it. The holes match anything, so the
            // words around them have to be worth matching on: "{0} · {1}"
            // would claim every line with a dot in it.
            var words = en.replace(/\{\d+\}/g, '').replace(/[^A-Za-z]/g, '');
            if (words.length < 2) return;
            var order = [];
            var re = '^' + en.split(/(\{\d+\})/).map(function (part) {
                var hole = /^\{(\d+)\}$/.exec(part);
                if (!hole) return escapeRe(part);
                order.push(+hole[1]);
                return '(.+?)';
            }).join('') + '$';
            var lit = en.split(/\{\d+\}/).sort(function (a, b) { return b.length - a.length; })[0];
            d.templates.push({ re: new RegExp(re), out: out, order: order, lit: lit, weight: words.length });
        });

        // The most specific sentence wins when two fit: more words, fewer holes.
        d.templates.sort(function (a, b) { return b.weight - a.weight; });
        d.cache.clear();

        delete loading[code];
        if (code === current) apply();
    }

    /* ------------------------------------------------------------------ *
     * Looking one piece of text up
     * ------------------------------------------------------------------ */

    var SEPARATORS = [' · ', ' — ', ' – ', ' | '];

    /** The translation of `key` (already normalised), or null. */
    function lookup(key, depth) {
        if (!dict) return null;
        if (dict.cache.has(key)) return dict.cache.get(key);
        var out = find(key, depth || 0);
        if (dict.cache.size > 6000) dict.cache.clear();
        dict.cache.set(key, out);
        return out;
    }

    function find(key, depth) {
        var hit = dict.exact.get(key);
        if (hit !== undefined) return hit;

        // Nothing to say in any language: a figure, a time, a lone "RM 12.30".
        if (!/[A-Za-z]{2}/.test(key.replace(/\b(RM|MB|KB)\b/g, ''))) return null;

        if (dict.cal) {
            for (var r = 0; r < DATE_RULES.length; r++) {
                var dm = DATE_RULES[r].re.exec(key);
                if (dm) return DATE_RULES[r].out(dict.cal, dm);
            }
        }

        for (var i = 0; i < dict.templates.length; i++) {
            var t = dict.templates[i];
            if (key.indexOf(t.lit) === -1) continue;
            var m = t.re.exec(key);
            if (!m) continue;
            var values = [];
            t.order.forEach(function (slot, n) { values[slot] = m[n + 1]; });
            return t.out.replace(/\{(\d+)\}/g, function (all, slot) {
                var v = values[slot];
                if (v === undefined) return '';
                // What went into the hole is often words too: a category, a
                // month, "3 entries". Translated if it can be, kept if not.
                var inner = depth < 3 ? lookup(norm(v), depth + 1) : null;
                if (inner === null && depth < 3) {
                    // Or a word app.js read back off the page, already in
                    // another language: "日期, dd-mm-yyyy" after a switch.
                    var en = englishOf(v);
                    if (en !== null) inner = lookup(en, depth + 1);
                }
                if (inner === null) return v;
                // " · nothing owed" goes back with the space it came with.
                return (/^\s/.test(v) ? ' ' : '') + inner + (/\s$/.test(v) ? ' ' : '');
            });
        }

        if (depth < 3) {
            // "Food · 3 entries": each side on its own.
            for (var s = 0; s < SEPARATORS.length; s++) {
                var sep = SEPARATORS[s];
                if (key.indexOf(sep) === -1) continue;
                var parts = key.split(sep), any = false;
                var done = parts.map(function (part) {
                    var p = norm(part);
                    var tr = p ? lookup(p, depth + 1) : null;
                    if (tr !== null) any = true;
                    return tr === null ? part : tr;
                });
                if (any) return done.join(sep);
            }

            // "Saved." when only "Saved" is listed.
            var tail = /^(.*[A-Za-z].*?)([.:!?,…])$/.exec(key);
            if (tail) {
                var body = lookup(tail[1], depth + 1);
                if (body !== null) return body + (dict.punct[tail[2]] || tail[2]);
            }
        }
        return null;
    }

    /** English for text that is already a translation — app.js copied it somewhere. */
    function englishOf(text) {
        var key = norm(text);
        for (var code in dicts) {
            var en = dicts[code].back.get(key);
            if (en !== undefined) return en;
        }
        return null;
    }

    /**
     * `raw` in the language on screen, keeping the spaces it was joined to its
     * neighbours with. `alias` is the key to look up instead, for an English
     * word that means two things — see data-i18n below.
     */
    function translate(raw, alias) {
        if (!dict) return raw;
        var key = norm(raw);
        if (!key) return raw;
        var out = (alias && lookup(norm(alias), 0)) || lookup(key, 0);
        if (out === null) return raw;
        return (/^\s/.test(raw) ? ' ' : '') + out + (/\s$/.test(raw) ? ' ' : '');
    }

    /* ------------------------------------------------------------------ *
     * The page
     * ------------------------------------------------------------------ *
     * Each node remembers the English it started as and what was written over
     * it, so it can be put into another language — or back — later. Text that
     * does not match what was written is new text from app.js, and starts
     * again from there.
     */
    var textMemo = new WeakMap();  // Text node -> { en, out }
    var attrMemo = new WeakMap();  // Element -> { attr: { en, out } }

    function skipped(el) {
        for (; el && el.nodeType === 1; el = el.parentNode) {
            if (SKIP[el.nodeName] || el.getAttribute('translate') === 'no' || el.isContentEditable) return true;
        }
        return false;
    }

    function sourceOf(now, memo) {
        if (memo && now === memo.out) return memo.en;
        var en = englishOf(now);
        return en === null ? now : (/^\s/.test(now) ? ' ' : '') + en + (/\s$/.test(now) ? ' ' : '');
    }

    /**
     * "Expenses" is the name of a screen and also a total beside "Income", and
     * Chinese says those two differently. An element can carry the key to use
     * for its text — <span data-i18n="Expenses (total)">Expenses</span> — and
     * English, which has no entry for it, goes on showing the text itself.
     */
    function doText(node) {
        var now = node.data;
        if (!now || !/\S/.test(now)) return;
        var memo = textMemo.get(node);
        var en = sourceOf(now, memo);
        var host = node.parentNode;
        var out = translate(en, host && host.nodeType === 1 ? host.getAttribute('data-i18n') : null);
        if (out !== now) node.data = out;
        textMemo.set(node, { en: en, out: out });
    }

    function doAttr(el, name) {
        var now = el.getAttribute(name);
        if (!now || !/\S/.test(now)) return;
        var all = attrMemo.get(el);
        if (!all) attrMemo.set(el, all = {});
        var en = sourceOf(now, all[name]);
        var out = translate(en);
        if (out !== now) el.setAttribute(name, out);
        all[name] = { en: en, out: out };
    }

    function doAttrs(el) {
        for (var i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) doAttr(el, ATTRS[i]);
    }

    var FILTER = {
        acceptNode: function (n) {
            if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
            return (SKIP[n.nodeName] || n.getAttribute('translate') === 'no' || n.isContentEditable)
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    };

    function walk(root) {
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1) {
            if (FILTER.acceptNode(root) === NodeFilter.FILTER_REJECT) return;
            doAttrs(root);
        }
        var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER);
        for (var n = tw.nextNode(); n; n = tw.nextNode()) {
            if (n.nodeType === 3) doText(n); else doAttrs(n);
        }
    }

    var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.type === 'childList') {
                if (!r.addedNodes.length || skipped(r.target)) continue;
                for (var j = 0; j < r.addedNodes.length; j++) {
                    if (r.addedNodes[j].isConnected) walk(r.addedNodes[j]);
                }
            } else if (r.type === 'characterData') {
                if (!skipped(r.target.parentNode)) doText(r.target);
            } else if (r.type === 'attributes') {
                if (!skipped(r.target)) doAttr(r.target, r.attributeName);
            }
        }
        // What is queued now is the echo of the writes just made, and there is
        // nothing left in it to translate.
        observer.takeRecords();
    });

    var watching = false;
    function watch(on) {
        if (on === watching) return;
        watching = on;
        if (on) {
            observer.observe(document.documentElement, {
                childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ATTRS,
            });
        } else {
            observer.disconnect();
        }
    }

    /* ------------------------------------------------------------------ *
     * Choosing a language
     * ------------------------------------------------------------------ */

    function saved() {
        try {
            var code = localStorage.getItem(KEY);
            if (code && LANGS[code]) return code;
        } catch (err) { /* private window: fall through to the browser's own */ }
        var nav = String(navigator.language || '').toLowerCase();
        if (nav.indexOf('ms') === 0) return 'ms';
        if (nav.indexOf('zh') === 0) return 'zh';
        return 'en';
    }

    var current = saved();

    /**
     * The script for a language is only fetched when that language is picked:
     * an English reader never downloads the other two. A file of our own
     * origin, so the Content-Security-Policy in index.html already allows it.
     */
    function load(code) {
        if (dicts[code] || loading[code]) return;
        loading[code] = true;
        var s = document.createElement('script');
        s.src = 'lang/' + code + '.js?v=' + VERSION;
        s.onerror = function () {
            delete loading[code];
            reveal();
            console.warn('MoneyFlow: could not load the ' + LANGS[code].name + ' dictionary — staying in English.');
        };
        (document.head || document.documentElement).appendChild(s);
    }

    /** Matches the ?v= in index.html — bump the two together. */
    var VERSION = '25';

    function apply() {
        var code = current;
        dict = code === 'en' ? null : (dicts[code] || null);
        document.documentElement.lang = LANGS[code].html;

        if (code !== 'en' && !dict) { load(code); return; }

        watch(false);
        walk(document.documentElement);
        if (dict) watch(true);
        paintPickers();
        reveal();
        try { document.dispatchEvent(new CustomEvent('mf:lang', { detail: code })); } catch (err) { /* old browser */ }
    }

    function set(code) {
        if (!LANGS[code]) return;
        try { localStorage.setItem(KEY, code); } catch (err) { /* not vital: it lasts the session */ }
        if (code === current && (code === 'en' || dict)) return;
        current = code;
        apply();
    }

    /* ------------------------------------------------------------------ *
     * The pickers: a select in the web topbar, a row of buttons in the
     * phone's More sheet. Both are in index.html; either may be missing.
     * ------------------------------------------------------------------ */

    function paintPickers() {
        var select = document.getElementById('langPick');
        if (select) select.value = current;
        var row = document.querySelectorAll('[data-lang]');
        for (var i = 0; i < row.length; i++) {
            var on = row[i].getAttribute('data-lang') === current;
            row[i].classList.toggle('is-on', on);
            row[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function wirePickers() {
        var select = document.getElementById('langPick');
        if (select) select.addEventListener('change', function () { set(select.value); });
        document.addEventListener('click', function (event) {
            var btn = event.target.closest && event.target.closest('button[data-lang]');
            if (btn) set(btn.getAttribute('data-lang'));
        });
        paintPickers();
    }

    /* ------------------------------------------------------------------ *
     * The first paint
     * ------------------------------------------------------------------ *
     * This file runs in <head>, before there is a body. For anything but
     * English the boot screen's words wait until the dictionary is in, so
     * they do not open in English and flick over — and are let go after a
     * moment regardless, in case the file never comes.
     */
    function reveal() {
        document.documentElement.classList.remove('is-translating');
    }

    if (current !== 'en') {
        document.documentElement.classList.add('is-translating');
        setTimeout(reveal, 2500);
    }
    apply();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            wirePickers();
            // The parser was still writing the page when the dictionary came
            // in; one sweep catches anything the observer saw half-made.
            if (dict) walk(document.documentElement);
        });
    } else {
        wirePickers();
    }

    /** What the console, lang/*.js and app.js can reach. Nothing here touches a record. */
    Object.defineProperty(window, 'MFI18n', {
        value: Object.freeze({
            add: add,
            set: set,
            get lang() { return current; },
            languages: Object.keys(LANGS),
            /** One string, in the language on screen — for text that never reaches the page. */
            t: function (english) { return dict ? translate(String(english)) : String(english); },
            /** A block of lines (a summary for the clipboard), line by line. */
            lines: function (text) {
                return dict ? String(text).split('\n').map(translate).join('\n') : String(text);
            },
            /** Every piece of English on screen right now that has no translation. */
            missing: function () {
                if (!dict) return [];
                var out = new Set();
                var wordy = function (k) { return /[A-Za-z]{2}/.test(k.replace(/\b(RM|MB|KB)\b/g, '')); };
                var check = function (now, memo, label) {
                    if (memo && memo.out === now && memo.out !== memo.en) return; // translated
                    var k = norm(memo && memo.out === now ? memo.en : now);
                    if (wordy(k) && lookup(k, 0) === null && englishOf(k) === null) out.add(label + k);
                };
                var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER);
                for (var n = tw.nextNode(); n; n = tw.nextNode()) {
                    if (n.nodeType === 3) { check(n.data, textMemo.get(n), ''); continue; }
                    var all = attrMemo.get(n) || {};
                    for (var a = 0; a < ATTRS.length; a++) {
                        var v = n.getAttribute(ATTRS[a]);
                        if (v) check(v, all[ATTRS[a]], '@' + ATTRS[a] + ': ');
                    }
                }
                return Array.from(out);
            },
        }),
    });
})();
