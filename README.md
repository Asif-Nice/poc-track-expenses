# Wedding Budget

A single-page wedding budget tracker. Record what each part of the wedding is expected to
cost, then record every payment against it — including **who in the family paid**. No
server, no database, no build step.

**Live:** https://asif-nice.github.io/poc-track-expenses/

## Where your data lives — pick one

Set this in ⚙ Settings. The app works the same either way; only the storage changes.

| | Setup | Good for | Watch out for |
|---|---|---|---|
| **An Excel file on this device** | Pick a `.xlsx` once | Everyday use. No account, no token, works offline. Put the file in OneDrive and it is backed up and synced | Chrome/Edge on a computer only. Browsers forget file permission on restart, so one click to reconnect per session |
| **This browser** | Nothing | Phones, and Firefox | Lives on that device only. Clearing site data erases it — export a copy now and then |
| **A GitHub repository** *(default)* | A fine-grained token, once per browser | Automatic sync between devices | Needs the token, and on a public repo the data is world-readable |

The default is set by `defaultMode` in `assets/config.js` — currently `'github'`, so a new
device lands there and asks for a token once. Change it to `'file'` or `'browser'` if you
would rather not use a token at all; whatever you pick in ⚙ Settings on a device wins over
it from then on.

**The token is entered once per browser and then remembered** (`localStorage`). You are not
asked again on that device — not on reload, not tomorrow. A second device asks once too.

Moving between devices without GitHub: **↓ Export** on one, **↑ Import** on the other.

### Why the GitHub mode needs a token at all

Not because of multiple users. GitHub refuses **anonymous writes** to any repository,
including your own, so without a token the page could read the workbook but never save a
change.

**The token cannot be shipped in `assets/config.js`**, and not merely as a matter of taste:

- Every file in a repository published to Pages is served on a public URL — that holds
  whether the repository is private or not, because the *site* is public either way. A
  token written there is readable by anyone who views source, and one with
  `Contents: Read and write` lets a stranger rewrite the repository.
- GitHub's secret scanning revokes tokens found in pushed code, usually within minutes. It
  would stop working almost immediately.

There is no way around this for a page with no backend: any credential a static page can
read, its readers can read too. Entering it once per browser is the workaround, and it is
why the app never asks twice.

## The model

Two things, kept on two sheets:

| | |
|---|---|
| **Budget item** | something the wedding needs, and what it is expected to cost — *Catering — dinner, ₹5,00,000* |
| **Payment** | money actually handed over, against one item, by one named person — *₹50,000 by Ramesh (father) on 20 Apr* |

Several people can pay towards the same item, and one person can pay towards many. That
split is the point: the app is built to answer *"catering is ₹5 L, we've paid ₹2.1 L — and
who put that in?"* at a glance.

## Setup for the GitHub mode only

Skip this entirely unless you chose *A GitHub repository*.

**1 · Create a token** — [Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new):

| Field | Value |
|---|---|
| Repository access | *Only select repositories* → this repository |
| Permissions | **Contents: Read and write** |
| Expiration | your call — GitHub emails you before it lapses |

**2 · ⚙ → Keep the budget in → A GitHub repository → paste the token → Save.** It is
verified, then kept in that browser's `localStorage` and sent only to `api.github.com`. It
is never committed. Repeat once per device.

Each change becomes one commit, and the Pages workflow republishes the site.

## Using it

| | |
|---|---|
| **Add a budget item** | *＋ Budget item*, or press <kbd>B</kbd>. Starting fresh, the empty state offers a typical set of ~15 items in one click |
| **Record a payment** | *＋ Payment*, press <kbd>N</kbd>, the ₹ button on any item row, or click that item's bar in the chart |
| **Edit / delete** | ✎ and 🗑 on any row. Deleting an item removes its payments too, and says so first |
| **See an item's payments** | ▸ on its row in the *Budget items* table |
| **Filter** | category, person, or free-text search — one row at the top that scopes every chart and both tables. Clicking a person's bar filters by them |
| **Sort** | click any *Item*, *Estimated*, *Paid*, *Still to pay*, *Date*, or *Amount* header |
| **Export / import** | *↓ Export* downloads the workbook as it stands; *↑ Import* loads one back in, replacing what is on screen |
| **Status** | the pill in the header — it names where things are being saved. Click it to retry a failed save, reconnect the file, or reload |

Filtering by a person narrows the *payments*, never the budgets, so the page then reads as
"what has Ramesh covered" — the headline relabels itself to say so.

Edits show immediately and save in the background. Close the tab with a save still in
flight and the browser warns you.

In the GitHub mode, if two devices edit at once the save re-reads the file, replays your
change onto the latest version, and commits — so a concurrent edit merges rather than
clobbers. The local modes have no such race: one file, one writer.

## The charts

Each view answers a different question, all drawn as plain SVG against the same filtered
slice:

| View | Question it answers |
|---|---|
| Hero + meter | how far through the whole budget are we? |
| Highlight tiles | biggest remaining gap, top contributor, how many items are settled, latest payment |
| **Budget vs paid, by item** | which items are funded and which are lagging — track length is the estimate, fill is what is paid, red when it has gone over |
| **Who has contributed** | how much each person has put in, ranked |
| **Funding over time** | cumulative payments against the total-budget line — are we on track? |
| **Who paid for what** | a person × item grid; darker means more money |

Colour carries exactly one meaning throughout — *how much money* — on a single blue ramp.

The who-paid-for-what grid was first drawn as a stacked bar with a hue per person, and that
was wrong: different items draw different subsets of payers, so any two people can end up
touching, which is the all-pairs colour case. Only four of the reference palette's hues
clear it in both light and dark, and folding the fifth relative into grey would discard
exactly what this app exists to record. A grid of magnitudes takes a heatmap on one
sequential hue instead — identity comes from the row and column labels, so any number of
family members fit. Every chart also has a table twin below it, keyboard-reachable
tooltips, and light and dark steps chosen for their own surface rather than flipped.

## The workbook

Whichever mode you use, the bytes are the same `.xlsx`, with three sheets. The first two
are the data; the third is generated for you and never read back. That is what makes
Export → Import work between modes and devices.

**Budget**

| ID | Item | Category | Estimated | Notes |
|---|---|---|---|---|
| `i7f2a4b1` | Catering — dinner | Food & Catering | 500000.00 | 400 guests |

**Payments**

| ID | Item ID | Item | Date | Amount | Paid By | Payment Method | Notes |
|---|---|---|---|---|---|---|---|
| `p3c9d0e5` | `i7f2a4b1` | Catering — dinner | 2026-04-20 | 50000.00 | Ramesh (father) | UPI | Advance |

`Date` is a real Excel date (`yyyy-mm-dd`) and the money columns are real numbers
(`#,##0.00`), so sorting, filtering, and pivot tables work if you open the file in Excel.
`Item` is carried alongside `Item ID` so the sheet reads on its own.

A payment is matched by `Item ID` first, then by item name — so you can type a row straight
into Excel with just the name, and an unrecognised name creates that item rather than
dropping the row. **Don't edit the ID columns**; they are what the app matches on. Extra
columns you add are not preserved the next time the app writes the file.

**Summary** — one row per item with live `SUMIF` formulas for paid and still-to-pay, plus a
total row. Cached values are written alongside each formula, so the numbers are right
whether or not the reader evaluates formulas.

If the file still holds the flat `Expenses` sheet from the earlier version of this app, it
is migrated on read: each old row becomes a payment against an item named for its category,
with the payer recorded as *Unrecorded*. Nothing is dropped. That conversion is written back
the first time you save.

## Privacy

This only applies to the **GitHub** mode. A file on your device or in your browser is never
uploaded anywhere — the page is static and talks to no server.

**In the GitHub mode on this public repository, `data/expenses.xlsx` is readable by
anyone** — directly from the repo and from the published site. For a wedding budget that
means family members' names and what each of them paid. Consider that before entering real
figures.

Two ways to change it:

- **Don't use the GitHub mode** — the default, a file on your device, keeps the data off
  the internet entirely. This is the simplest answer.
- **Split repos** — public repo for the app, private repo for the workbook; point
  `owner`/`repo` in `assets/config.js` at the private one. Free, and the data never touches
  the public site.
- **GitHub Pro** (~$4/month) — keep the repo private and Pages still publishes. Note the
  Pages *site* stays reachable by URL regardless; to keep the data off it, drop `data/` from
  the artifact in `deploy.yml` and let the app read through the API with your token.

## Deployment

`.github/workflows/deploy.yml` publishes this repo to Pages via `actions/deploy-pages`, on
every push to `main` and on demand (*Actions → Deploy to GitHub Pages → Run workflow*).
There is no build step — the artifact is the repo as-is.

Every edit is a commit, so every edit triggers a deploy. Runs supersede each other
(`cancel-in-progress`), so a burst of edits collapses into one publish.

## Configuration

`assets/config.js`:

```js
window.EXPENSE_CONFIG = {
  owner: null,          // null → detected from the Pages URL
  repo: null,           // null → detected from the Pages URL
  branch: 'main',
  filePath: 'data/expenses.xlsx',   // GitHub mode only; local modes use the file you pick
  budgetSheet: 'Budget',
  paymentSheet: 'Payments',
  locale: 'en-IN',
  currency: 'INR',
  categories: [...],    // groups a budget item can belong to
  payers: [],           // seeds the "Paid by" suggestions; any name typed is accepted
  methods: [...],
  starterItems: [...],  // the one-click typical plan offered from the empty state
};
```

Currency and locale can also be changed at runtime in Settings (stored per browser). With
`INR`, chart and tile figures are shortened the way people say them — ₹5 L, ₹1.2 Cr.

## Layout

```
index.html                       markup
assets/styles.css                design tokens, light + dark
assets/app.js                    state, xlsx ↔ rows, GitHub API, commit queue, charts, rendering
assets/config.js                 your settings
assets/vendor/xlsx.full.min.js   SheetJS 0.18.5, vendored — no CDN, no npm install
data/expenses.xlsx               your data
.github/workflows/deploy.yml     Pages deploy
```

## Notes and limits

- In the GitHub mode, one commit per change — so `main`'s history is a full audit trail,
  and it grows a commit per payment. The API allows 5,000 authenticated requests/hour and
  each save uses two.
- The file mode rewrites the whole workbook on every change, which is instant at this size
  and means the file on disk is never half-written.
- Only the GitHub mode syncs devices by itself. With a local store, two devices are two
  budgets until you Export/Import between them.
- Amounts are stored to 2 decimals in a single currency — no FX conversion.
- A person is identified by the name you type. Two spellings are two people; the *Paid by*
  field suggests names already used, which is what keeps them consistent.
- A token in `localStorage` is readable by anything that can run script on this origin.
  Scope it to this one repo and revoke it if a device is lost.
- Local development: `python -m http.server` from the repo root, then visit
  `http://localhost:8000` and set `owner`/`repo` in `assets/config.js` (auto-detection
  needs a `github.io` host).
