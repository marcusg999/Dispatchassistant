# Dispatch Bro

An office-operations aid for companies that handle art and build crates, built as a **white-label** product: every name, color and line of copy comes from one file, `src/brand/brand.config.ts`.

**Phase 1 (this repo today): the anonymous suggestion box.** Crews open a private link, write what's on their mind, optionally attach a photo, and get a tracking code. Nobody is asked for a name, email or login. The office reads, triages and replies in a private admin console that requires a Google sign-in from an allow-listed address.

Later phases (dispatch board, estimates, industry news) are listed in [ROADMAP.md](ROADMAP.md). Every future module will require sign-in; only the suggestion box is anonymous.

- Live site (default Netlify URL): `https://dispatch-bro-app.netlify.app`
- Portal link: `https://dispatch-bro-app.netlify.app/s/<PORTAL_KEY>` (secret path; everything else returns 404)
- Admin console: `https://dispatch-bro-app.netlify.app/admin`

Other docs: [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) (manual production setup) · [SECURITY.md](SECURITY.md) (threat model) · [DECISIONS.md](DECISIONS.md) (why things are the way they are) · [ROADMAP.md](ROADMAP.md)

---

## Architecture

```
 Phone / break-room browser                         Office browser
 ─────────────────────────                         ──────────────
 /s/<PORTAL_KEY>  (portal bundle)                   /admin  (admin bundle)
   • Preact (React API), zod/mini                     • React, supabase-js
   • NO Supabase client, NO keys                      • publishable key + admin's own session
        │  same-origin fetch, x-portal-key header           │  every query runs under RLS
        ▼                                                   ▼
 Netlify Functions (secret key lives ONLY here)      Supabase (Postgres · Auth · Storage)
   POST /api/submit      ─── insert + photo upload ──▶   suggestions, admin_notes,
   GET  /api/status/:hash ── portal_status() ───────▶    admins, audit_log  (RLS on all)
   GET  /api/board        ── portal_board() ────────▶    private bucket: suggestion-photos
   keep-alive (daily, free plan)                         Google OAuth, before-user-created hook
```

- **Two isolated Vite builds** (`vite.portal.config.ts`, `vite.admin.config.ts`), so the portal's module graph can never include admin code or `supabase-js`.
- **Routing and the admin CSP are generated at build time** by `scripts/postbuild.mjs` into `dist/_redirects` and `dist/_headers`, because they depend on env vars (`PORTAL_KEY`, `VITE_SUPABASE_URL`). Static headers live in `netlify.toml`.
- **Data access** is in thin typed modules: `src/admin/data.ts` (console) and `netlify/lib/db.ts` (functions). Types are generated from the schema into `src/shared/database.types.ts`.
- **Schema** is only ever changed through `supabase/migrations/*.sql`. Never click schema changes in the dashboard.

| Path | What |
| --- | --- |
| `src/brand/brand.config.ts` | The one file to edit when rebranding |
| `src/portal/` | Public portal (form, crate-tag success, status, board) |
| `src/admin/` | Admin console (inbox, detail, audit, admins, backup & flyer) |
| `src/shared/` | Domain enums, validation (zod/mini), tracking codes, generated DB types, flyer helpers |
| `netlify/functions/` | `submit`, `status`, `board`, `keep-alive` |
| `netlify/lib/` | Server-only helpers (DB client, HTTP, photo checks, Turnstile) |
| `supabase/` | `config.toml`, migrations, `seed.sql` (local only) |
| `scripts/` | `postbuild.mjs`, `check-dist.mjs`, `serve.mjs` (local prod-like server), `flyer.mjs` |
| `tests/` | `unit/`, `integration/`, `rls/`, `e2e/`, `fixtures/` |

---

## Local development

Prerequisites: Node 20+ (22 recommended), Docker (for the local Supabase stack).

```bash
npm ci
```

```bash
npx supabase start
```

Copy the env template and fill it with the local values the CLI prints:

```bash
cp .env.example .env
```

```bash
npx supabase status -o env
```

Set in `.env`:

| Variable | Local value |
| --- | --- |
| `PORTAL_KEY` | any 16+ URL-safe characters, e.g. `local-dev-portal-key-1234` |
| `SUPABASE_URL` | `API_URL` from the status output (`http://127.0.0.1:54321`) |
| `SUPABASE_SECRET_KEY` | `SECRET_KEY` (`sb_secret_…`, the local well-known key) |
| `VITE_SUPABASE_URL` | same as `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` (`sb_publishable_…`) |
| `SUPABASE_JWT_SECRET` | `JWT_SECRET` (local tests only: the RLS suite signs test JWTs with it; never set in Netlify) |

Apply migrations and seed data:

```bash
npx supabase db reset
```

Start the dev server (serves both apps with the production routing rules and runs the real functions in-process; no Netlify CLI needed):

```bash
npm run dev
```

- Portal: `http://localhost:5173/s/<PORTAL_KEY>`
- Admin: `http://localhost:5173/admin`

Seeded tracking codes to try on the status screen: `BRAVE-CANYON-ORBIT-MAPLE-1001`, `CLEVER-HARBOR-PILOT-STONE-2002`, `DAWN-FOREST-LUMBER-OCEAN-3003`. Seeded admins: `admin@example.com`, `second-admin@example.com`.

**Admin sign-in locally.** The console signs in with Google only. To use real Google sign-in locally, put `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in `.env` (and add your Google email to `public.admins`), then restart `supabase start`. Without Google credentials, use the seeded-session approach the E2E tests use (`tests/e2e/helpers.ts → signInAsAdmin`): it creates a local user for an allow-listed email and injects the session.

Production-like preview of the built site (same routing as `_redirects`, real functions):

```bash
npm run build && node scripts/serve.mjs 8888
```

Regenerate DB types after changing a migration:

```bash
npm run db:types
```

---

## Tests

| Command | What it covers | Needs |
| --- | --- | --- |
| `npm test` | Unit: validation, tracking-code entropy and hashing, brand contrast (WCAG AA), photo magic-byte/EXIF checks, xlsx/docx exports (files opened and checked) | nothing |
| `npm run test:db` | Integration: `submit`/`status`/`board` functions (valid, invalid, missing key, honeypot, replay, EXIF rejection, no logging of bodies/hashes) and RLS (anon, non-admin, admin, append-only audit, storage policies, last-admin guard, auth hook, hard delete) | `npx supabase start` |
| `npm run test:e2e` | Playwright at a 390×844 phone viewport: submit with/without photo and check status, GPS/EXIF proven gone from the stored photo, 404 surface, admin flows with a seeded session (search, re-tag, status, note, reply, publish, export xlsx + docx, audit, manage admins) | `npx supabase start` + `.env` |
| `npm run typecheck` | TypeScript across app, functions and tests | nothing |

Security advisor: run Supabase's database linter (splinter) against your project in the dashboard (Advisors → Security). Locally it reports no warnings, only informational "unused index" notices on a fresh database.

---

## Bundle verification (portal has no Supabase or admin code)

Verified at build time. Last measured: **portal JS ≈ 71 KB raw / ≈ 28 KB gzip** (budget: 150 KB).

How it's enforced:

1. **Separate build.** `vite.portal.config.ts` builds only `portal.html`. React APIs are aliased to `preact/compat` to stay small.
2. **Import guard.** The `forbid-admin-imports` plugin in that config throws if any portal source file imports anything matching `supabase` or `/admin/`.
3. **Dist scan.** `scripts/check-dist.mjs` runs after every build and fails it if any portal asset mentions `supabase`, contains the Supabase URL or publishable key, or contains admin-only identifiers, and if any file anywhere contains a secret key, a `service_role` JWT, or the `PORTAL_KEY`.
4. **Bundle analyzer.** Each build writes a treemap to `dist-stats/portal.html` (and `dist-stats/admin.html`). Open it to inspect what's in the portal bundle.

```bash
npm run build:portal && open dist-stats/portal.html
```

---

## Deploy

Netlify builds from `netlify.toml` (`npm run build`, publish `dist`, functions in `netlify/functions`). First-time setup is click-by-click in [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md). After that, every push to `main` deploys.

The build fails on purpose if, on Netlify, `PORTAL_KEY` or `VITE_SUPABASE_URL` is missing, or if `check-dist` finds a secret.

### Running migrations against production

Schema changes go through migrations only:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

`db push` applies new files in `supabase/migrations/` and never runs `seed.sql`. To create a new migration: `npx supabase migration new <name>`, write SQL, test with `npx supabase db reset` and `npm run test:db`, regenerate types, commit, then `db push`.

---

## Operating the suggestion box

### Share the portal link

The link is `https://dispatch-bro-app.netlify.app/s/<PORTAL_KEY>`. Share it through channels crews already use (group text, the printed flyer's QR code). Anyone with the link can submit, so treat it like a door code: not secret from crews, but not public.

### Print the flyer

- **From the console:** Admin → **Backup & flyer** → paste the portal link → **Print flyer** (choose "Save as PDF" in the print dialog for a file). The link isn't stored anywhere.
- **From the command line:** `npm run flyer -- https://dispatch-bro-app.netlify.app/s/<PORTAL_KEY>` writes `flyer-out/flyer.html` and `flyer-out/flyer.pdf` (`flyer-out/` is git-ignored because it contains the key).

Both use the brand config, so the flyer rebrands with everything else.

### Rotate `PORTAL_KEY` (retire a leaked link)

1. Generate a new key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```
2. Netlify → Site configuration → Environment variables → `PORTAL_KEY` → set the new value.
3. **Redeploy** (Deploys → Trigger deploy → Deploy site). This is required: the secret path is written into `dist/_redirects` at build time, and functions read env at deploy.
4. Print a new flyer and share the new link.

After the deploy, the old link returns 404 and the functions reject the old key, so a leaked link stops working. Existing tracking codes keep working with the new link.

### Add or remove admins

- **In the console:** Admin → **Admins** → add a Google email, or **Remove**. Changes are recorded in the audit log. Removing yourself signs you out.
- **The very first admin** has to be inserted with SQL (Supabase → SQL Editor), see [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md):
  ```sql
  insert into public.admins (email) values ('you@example.com');
  ```
- **The last admin can never be removed.** A database guard refuses it, even for the service role and even if two admins remove each other at the same moment.
- Non-allow-listed Google accounts can't even create a user (before-user-created hook), and RLS returns nothing to them.

### Keep-alive (Supabase free plan)

Free Supabase projects pause after a period of inactivity. `netlify/functions/keep-alive.mts` is a Netlify scheduled function that runs one trivial query daily. On a paid plan, set `KEEP_ALIVE_ENABLED=false` in Netlify or delete the file.

### Backups

- **Admin → Backup & flyer → Download backup (.json):** all non-deleted suggestions and their private notes. Photos and tracking hashes are not included. Every download is audited. Store the file somewhere safe: it contains everything people wrote.
- **Supabase plans:** the **free plan does not include downloadable automated backups**. **Pro** includes daily backups with 7-day retention; Point-in-Time Recovery is a paid add-on. Check Supabase's pricing page for current details.
- **Recommendation on the free plan:** download a JSON backup regularly, and keep a schema + data dump:
  ```bash
  npx supabase db dump --linked -f backup_schema.sql
  ```
  ```bash
  npx supabase db dump --linked --data-only -f backup_data.sql
  ```

---

## HR eyes only (named personal issues)

The portal has a second section, **"Personal issue · HR eyes only"**, chosen with the switch at the top of the form. Unlike the suggestion box it is **not anonymous**: a name is required and a phone or email is optional. No photo is allowed.

- Stored in `hr_reports` (migration `20261119000600_hr_reports.sql`), separate from the anonymous `suggestions` table.
- Readable only by emails in `hr_staff`. **Admins can't see HR reports**, and HR members can't see anonymous suggestions unless they're also admins.
- HR members sign in to the same console with Google and get **HR inbox** (status, reply, private HR notes, trash/delete, Excel export, JSON backup) and **HR team** (manage the HR list; the last member can't be removed).
- The submitter gets a tracking code like any other, and the status screen shows HR's reply.
- Add the first HR member with SQL (SETUP_CHECKLIST step 3.4). After that, HR manages its own list.
- Copy (labels, the not-anonymous notice) lives in `brand.config.ts` → `portal.hr`.

## Rebrand for a new client

Everything visible comes from `src/brand/brand.config.ts`. Don't put a company name anywhere else (a unit test fails if the app name appears outside that file).

1. Edit `src/brand/brand.config.ts`:
   - `appName`, optional `companyName` (shown as "App · Company")
   - `logoPath`: drop the logo in `public/` (e.g. `public/logo.svg`) and set `logoPath: '/logo.svg'`. Leave `''` for the type-only wordmark.
   - `colors` (`wall`, `paper`, `ink`, `muted`, `line`, `accent`, `accentText`, `focus`, `danger`) and `tagColors` for Important / Urgent / Crucial
   - `supportLine`, `officeNoun` (default "the office"), and `portal` copy (`eyebrow`, `headline`, `welcome`, `promise`). Keep the promise honest; never claim "untraceable".
2. Run `npm test`. The contrast test checks every text/background pair against WCAG AA.
3. Build and look at the portal, the admin console and a printed flyer.
4. Deploy, then print new flyers.

Colors become CSS variables (`--brand-*`) at build time via the `virtual:brand.css` module, and Tailwind tokens point at them, so the portal, admin console, exports (tag colors) and flyer all re-skin together.

---

## Switching to a custom domain

The site URL is never hardcoded: functions use the request's own origin and the console uses `location.origin` for OAuth redirects. To move from `dispatch-bro-app.netlify.app` to e.g. `suggest.example.com`:

1. **Netlify:** Domain management → Add a domain → follow the DNS steps, and wait for HTTPS to be provisioned.
2. **Supabase:** Authentication → URL Configuration → set **Site URL** to `https://suggest.example.com` and add `https://suggest.example.com/auth/callback` to **Redirect URLs** (keep the Netlify URL during the switch, then remove it).
3. **Google Cloud:** APIs & Services → Credentials → your OAuth client → add `https://suggest.example.com` to **Authorized JavaScript origins**. The redirect URI (`https://<project-ref>.supabase.co/auth/v1/callback`) does not change.
4. **Flyer:** the QR code encodes the full link, so print new flyers with the new link and replace the old ones.
5. Optional: in Netlify, redirect the old `*.netlify.app` domain to the new one.

---

## Optional: Cloudflare Turnstile (off by default)

Turn this on only if spam becomes a problem. It adds a third-party script to the portal, which the portal otherwise avoids completely.

What exists today: **server-side verification** in `netlify/lib/turnstile.ts`. `submit` calls it automatically when `TURNSTILE_SECRET_KEY` is set, and it never sends the client IP to Cloudflare.

What's **not wired yet** is the portal widget. To enable it:

1. Create a Turnstile widget in the Cloudflare dashboard for your domain. Note the site key and secret key.
2. Netlify env: set `TURNSTILE_SECRET_KEY` (Functions) and `VITE_TURNSTILE_SITE_KEY` (Builds).
3. In the portal form (`src/portal/SubmitForm.tsx`), when `import.meta.env.VITE_TURNSTILE_SITE_KEY` is set: load `https://challenges.cloudflare.com/turnstile/v0/api.js`, render the widget, and append its token to the submit `FormData` as `cf-turnstile-response`.
4. Loosen the portal CSP in `netlify.toml` (`[[headers]] for = "/s/*"`): add `https://challenges.cloudflare.com` to `script-src`, `connect-src` and a new `frame-src`.
5. Update the "No accounts, cookies or tracking" footer line if it's no longer accurate, and note the change in `SECURITY.md`.
6. Redeploy.

Without step 3, setting `TURNSTILE_SECRET_KEY` would make every submit fail, so set it only together with the widget.
