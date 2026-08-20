# Keeping a copy in Google Drive

MoneyFlow records everything in your browser first — that never changes, and
the app works with no account and no network. What this adds is a **second
copy in your own Google Drive**, so a cleared browser is an inconvenience
rather than a loss, and so you can carry your ledger to another computer.

Two buttons in the topbar, and a switch:

- **To Drive** — writes what is on this machine into the folder.
- **From Drive** — replaces what is on this machine with what is in the folder.
  It tells you what is in both copies and waits for you to agree.
- **Auto** — off unless you turn it on. See below.

**With Auto off, nothing leaves this browser unless you press a button.** That
is the default, and it is the state the app ships in.

Beside them sits the only status worth showing: *Saved to Drive today*, or *5
days ago*, going amber after a week. If it says **Not in Drive yet**, nothing
from this browser has ever been sent.

---

## Auto

Turned on, MoneyFlow sends a copy about **a minute after you stop editing**, so
the Drive copy stops being as old as the last time you remembered to press a
button. Two rules keep it out of the way:

- **It never opens a sign-in window.** If your Google session has lapsed, the
  automatic push quietly stands down and the stamp goes stale — which is the
  signal to press **To Drive** yourself. A popup nobody asked for gets blocked,
  and one that is not blocked is worse.
- **It waits for the typing to stop.** One evening's entries is one upload, not
  a hundred.

A failed automatic push does not put a dialog in front of you either. The stamp
going stale says it, and pressing the button gives you the real error.

Turn it on if you would rather not think about backups. Leave it off if you
would rather the app never spoke to the network on its own — both are
reasonable, which is why it is a switch.

---

## Archive — the copy that is never overwritten

**To Drive** keeps *one* file and replaces it every time. That is what a backup
should do — a backup you cannot trust to match is no backup — but it means the
folder is a **mirror**, not a place history is kept. Delete an old bill here,
and the next save deletes it there too.

**Archive** writes a different kind of file: `moneyflow-archive-2026-08-20-1432.json`,
created fresh and never written to again. Take one before pruning anything, and
the records you remove are still in Drive with the date on them, whatever the
live copy does afterwards.

Archives pile up rather than replacing each other, which is the point. Tidy
them yourself in Drive when there are more than you want.

---

## Coming back to an empty browser

Open MoneyFlow on a machine holding no records — a new laptop, or one whose
browsing data was cleared — and a green strip appears across the top:

> There are no records in this browser. If you have a copy in your Google
> Drive folder, bring it down.

Pressing **Check Drive** is the same as pressing **From Drive**: it reads the
folder, tells you what is in both copies and their dates, and waits for you to
agree before replacing anything.

It offers rather than does. A pull replaces what is here, and doing that on its
own — before you have even looked at the screen — is not a decision the app
gets to make for you. It also never appears on a browser that already holds
records, so it is not something you will see twice.

---

## Before you start: check who can see that folder

Open the folder in Drive → **Share** → **General access**.

It must say **Restricted**. If it says *Anyone with the link*, then anyone
holding that link can read your salary, your balances and every entry you have
ever made. A finance folder is not a folder to share.

---

## Step 1 — Make a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Project dropdown at the top → **New project**. Name it `MoneyFlow`. Create.
3. Make sure the project selector now says **MoneyFlow** before going on. Every
   step after this applies to whichever project is selected, and setting up the
   wrong one is the single easiest mistake to make here.

There is no cost. This kind of project is free, and Drive API calls at this
volume are free.

## Step 2 — Switch the Drive API on

**APIs & Services** → **Library** → search **Google Drive API** → **Enable**.

Without this, sign-in works and every save fails — which reads as a broken
button rather than a missing switch.

## Step 3 — The consent screen

**APIs & Services** → **OAuth consent screen**.

1. User type **External**. Create.
   (*Internal* is for Google Workspace organisations. A personal Gmail account
   has no such option.)
2. App name `MoneyFlow`, your email as both the user support and developer
   contact. Save and continue.
3. **Scopes** → **Add or remove scopes** → filter for `drive.file` and tick
   **`.../auth/drive.file`** — *"See, edit, create and delete only the specific
   Google Drive files you use with this app."* Update, then Save and continue.
4. **Test users** → **Add users** → your own Gmail address. Save.

> **Why `drive.file` and nothing wider.** It gives the app access to the files
> it creates itself and nothing else. It cannot read your other documents and
> cannot list your Drive, which is both the right amount of access and the
> reason this needs no review from Google. The broader `drive` scope would work
> too, and would put your entire Drive behind a client ID published on GitHub.
> Do not.

> **Leave it in Testing.** Publishing invites a verification process you have no
> use for. Testing works indefinitely for the test users you listed. The cost
> is that Google re-asks for consent from time to time — a few clicks, months
> apart.

## Step 4 — The client ID

**APIs & Services** → **Credentials** → **Create credentials** → **OAuth client
ID**.

- Application type: **Web application**
- Name: `MoneyFlow web`
- **Authorised JavaScript origins** — add both, exactly, with no trailing slash:
  - `https://kaonhew02.github.io`
  - `http://localhost:4780`
- **Authorised redirect URIs**: leave empty. This app never redirects; it takes
  its token in a pop-up.

Create. Copy the client ID — it ends in `.apps.googleusercontent.com`.

> There is a client *secret* on that screen too. This app does not use it and
> must not. A secret published in a GitHub repo is not a secret.

## Step 5 — Paste it in

Open `drive-config.js` and replace the placeholder:

```js
const MF_DRIVE = {
    clientId: '1234567890-abcdefg.apps.googleusercontent.com',
    folderId: '125XwuaPewNzYeCTgemOAnA9j0MXOoS-I',
    filename: 'moneyflow-data.json',
};
```

The folder ID is already filled in — it is the part of the folder's URL after
`/folders/`. Both values are safe to commit; neither grants anything on its own.

## Step 6 — Try it

Run the app (`MoneyFlow.cmd`) and press **To Drive**. Google asks you to sign
in and to allow MoneyFlow access — once. Then `moneyflow-data.json` appears in
your folder.

To prove the round trip: press **From Drive** and it should offer to replace
your records with an identical copy. Agreeing is harmless.

---

## What this is, and what it is not

**It is a copy you press for.** There is no background sync. If you record ten
entries and never press **To Drive**, Drive still holds what it held before.
The topbar says when you last sent anything, and turns red after a week.

**It is not multi-device editing.** If you use MoneyFlow on two computers, each
holds its own records and Drive holds whichever pressed **To Drive** last.
Pressing **From Drive** on the other machine then throws away that machine's
work. The safe habit is one machine editing, the others only pulling.

Wanting to record on your phone *and* your laptop is a different requirement —
it needs a database, not a file, and MoneyFlow does not have one.

---

## When something breaks

**"Drive is not set up yet"** — `drive-config.js` still has the placeholder
client ID. Step 5.

**The sign-in window opens and closes immediately** — the address you are on is
not in the authorised origins list. Step 4. `http://localhost:4780` and
`https://kaonhew02.github.io` are different origins and both need to be there.

**"Access blocked: MoneyFlow has not completed the Google verification
process"** — you are signed into a Google account that is not on the test users
list. Step 3, item 4.

**"Google refused the sign-in: idpiframe_initialization_failed"** or a silent
failure with third-party cookies blocked — the sign-in library needs
`accounts.google.com` allowed. Check extensions and strict privacy settings.

**Sign-in works, saving fails with 403** — the Drive API is not enabled on this
project. Step 2.

**"That folder no longer exists, or this account cannot see it"** — the folder
ID is wrong, or you signed in with a different Google account than the one that
owns the folder.

**It asks you to sign in again after a while** — expected. Access lasts about
an hour, and consent in Testing mode is periodically re-asked. Nothing is lost;
your records are in the browser regardless.
