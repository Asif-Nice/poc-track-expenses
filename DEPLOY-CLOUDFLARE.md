# Hosting this on Cloudflare

Free, and it redeploys on every push to `main`, exactly like the GitHub Pages workflow does
now. There is no build step — the repository *is* the site.

Cloudflare has two products that will do this, and **they are configured differently**. The
first attempt failed because a Pages instruction was followed in a Workers project:

```
Executing user deploy command: /
/bin/sh: 1: /: Permission denied
Failed: error occurred while running deploy command
```

`/` was entered as a **Deploy command**, so Cloudflare tried to *run* `/` as a program.
Workers has a "Deploy command"; Pages has a "Build output directory". Telling them apart:

| Your project shows… | It is | Path to follow |
|---|---|---|
| Build command · **Deploy command** · Build token | a **Worker** | A, below |
| Build command · **Build output directory** | a **Pages** project | B, below |

---

## Path A — fix the Worker you already have

Fewest clicks: the project exists and is already connected to the repository. The repo now
carries `wrangler.jsonc`, which tells Cloudflare to upload this directory as a static site,
so nothing needs typing into the build fields.

1. Open the project → **Settings → Build**.
2. Set the fields to exactly this — the point is that **Deploy command goes back to its
   default**, and nothing anywhere is `/`:

   | Field | Value |
   |---|---|
   | Build command | *(blank)* |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | `/` *(this one is a path, and is correct)* |

3. **Retry build.**

Your URL is then `https://poc-track-expenses.<your-subdomain>.workers.dev`.

Note that Workers URLs carry an account-level subdomain that Pages URLs do not. If you have
not set one, Cloudflare asks you to pick it — whatever you choose appears in the address, so
choose it with the same care as the project name.

---

## Path B — use Pages instead, for a shorter URL

Gives `https://poc-track-expenses.pages.dev` — no account subdomain. This is the address
originally aimed for. It needs no files from this repository at all; `wrangler.jsonc` is
simply ignored.

1. **Workers & Pages → Create** → choose the **Pages** tab → **Connect to Git**.
   (The Create button lands on Workers by default. The Pages tab is the one you want.)
2. Pick `Asif-Nice/poc-track-expenses`.
3. Project name: **`poc-track-expenses`** (pre-filled from the repo).
4. Build settings — **there is no Deploy command here**:

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(blank)* |
   | Build output directory | `/` |

5. **Save and Deploy.**

If you take this path, delete the broken Worker so the two do not both sit on the repo.

---

## Choosing the name

The subdomain **cannot be renamed later** — changing it means deleting the project and
making a new one. These were free when checked (lowercase, digits and hyphens only;
Cloudflare says immediately if one has since gone):

| Name | Gives |
|---|---|
| `poc-track-expenses` | matches the repo, pre-filled |
| `our-wedding-budget` | says what it is |
| `track-wedding-expenses` | |
| `shaadi-budget` | |
| `wedding-kharcha` | |

`wedding-budget`, `wedding-budget-tracker` and `wedding-expense-tracker` are already taken
by other people.

## After it is live

**Enter your GitHub token once on the new address.** Tokens live in `localStorage`, which is
per-origin, so the new URL starts out not knowing it — open ⚙ Settings and paste it in. Your
budget itself is untouched; it lives in the repo, not in the browser.

**Turning the old URL off** (optional). *Repo → Settings → Pages → Source → None*. Do this
only once the new URL works. Leaving it on costs nothing and keeps the old address as a
fallback.

## What this does and does not change

- **Does:** your username stops appearing in the address.
- **Does not:** make the budget private. This repository is public, so `data/expenses.xlsx`
  — the names and the amounts — is still readable by anyone at
  `github.com/Asif-Nice/poc-track-expenses`, whatever the site address is. A neutral URL is
  obscurity, not privacy. See the Privacy section of `README.md` for the options that
  actually close that.
