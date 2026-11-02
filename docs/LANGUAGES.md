# Languages

MoneyFlow shows in **English**, **Bahasa Melayu** or **中文 (简体)**, on the web
layout and the phone app alike.

- **On a computer:** the language box in the top bar, beside the Drive and
  Export buttons.
- **On a phone:** tap **More**. The **Language** row sits above
  Backup & sync.

The choice is kept in this browser (`moneyflow.lang` in localStorage), so it
belongs to the device and not to the book: it is not part of an export, and a
backup made in Chinese restores fine in English. A browser that has never
picked one starts in Malay or Chinese if the browser's own language is set to
that, and in English otherwise.

## How it works

`app.js` still writes every word in English. `i18n.js` translates the page
after it is drawn: each piece of text on screen is looked up by its English in
`lang/ms.js` or `lang/zh.js` and swapped, and a MutationObserver keeps doing
that as screens redraw. Only the dictionary for the language picked is
downloaded. Switching happens in place, with no reload.

Each dictionary entry has one of two forms:

    "Add item": "Tambah item",
    "Saved {0}": "已保存 {0}",

`{0}`, `{1}`… are where a figure, name or date goes. They can move to wherever
the sentence needs them, and whatever fills them is translated too when there
is an entry for it. Month and day names, and dates like `2 Nov`, `Aug 2026`
and `Monday, 2 November`, are written each language's way by the settings at
the bottom of each file.

Things that are never translated: what you type into a field, and your own
notes, accounts and names. A note that happens to say exactly the same as a
built-in word (say, an account called `Savings`) is shown in the chosen
language, the same as the built-in one.

## When something shows in English

A sentence that `app.js` gains or rewords later has no entry yet, so it shows
in English. Nothing breaks.

To find these: pick the language, open the screen, and in the console run

    MFI18n.missing()

It lists every piece of English on screen with no translation. Add each one to
`lang/ms.js` and `lang/zh.js`, keyed by the English exactly as listed, with any
figures replaced by `{0}`, `{1}`…

When the same English word means two things (the **Expenses** screen and the
**Expenses** total beside Income), the element can name a different key:
`<span data-i18n="Expenses (total)">Expenses</span>`. The English page still
shows the text itself.

Text that never reaches the page (the **Copy summary** text) is passed through
`MFI18n.lines()` in `copySummary`, so the clipboard gets the chosen language too.

## Adding another language

1. Copy `lang/ms.js` to `lang/<code>.js`, change the code in its
   `MFI18n.add(...)` line, and translate the values.
2. Add the code to `LANGS` at the top of `i18n.js`.
3. Add an `<option>` to `#langPick` and a button to `.sheet-lang` in
   `index.html`.
4. Add the file to `SHELL` in `sw.js` so it works offline.

After any change to these files, bump `?v=` in `index.html` and `VERSION` in
`i18n.js` together.
