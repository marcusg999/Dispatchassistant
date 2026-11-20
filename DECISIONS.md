# Decisions

A running log of product and engineering decisions: what was chosen, and why. Newest entries go at the bottom of each date.

## 2026-11-19

### Product owner answers (checkpoints)

- **Theme:** neutral default palette, defined entirely in `src/brand/brand.config.ts`. At the design check-in the product owner approved the "Gallery wall label" design and chose to **keep safety orange** (`#FF5A1F`) as the default accent for new clients.
- **Site name:** `dispatch-bro-app` → `https://dispatch-bro-app.netlify.app`. Used only in docs and the setup checklist; code reads the URL from the request / `location`.
- **Supabase plan: Free.** So the daily `keep-alive` scheduled function is included (`netlify/functions/keep-alive.mts`). Disable with `KEEP_ALIVE_ENABLED=false` or delete it on a paid plan.
- **Netlify plan: Free/Starter.** Platform rate limits are **declared** in each function's `config.rateLimit` (submit 10/min, status and board 60/min, aggregated by IP + domain). **Status: configured, not confirmed active.** Availability on the free tier must be verified in the Netlify dashboard after the first deploy (SETUP_CHECKLIST step 9). The portal key, honeypot, minimum time and validation work regardless.
- **First admin email(s):** to be confirmed at the pre-deploy checkpoint.

### Design

- `/surprise-me` was run as specified. The dice picked **Direction #1, "Gallery wall label"** (palette: concrete grey / safety orange / black; kinetic variable-weight headline; split-screen with a fixed pane).
- Two drawn techniques broke the user's guardrails and were **replaced**: the WebGL 3D hero became variable-font kinetic type (Archivo, `wdth` 62–125 and `wght` 100–900 axes), and the scroll-scrubbed video became the CSS-3D "crate tag" success moment with an SVG line-draw. No imagery, video or 3D on the portal. All motion respects `prefers-reduced-motion`.
- The signature moment is the tracking code arriving on a swinging orange crate tag. The wall pane carries a museum label plate ("Provenance: Anonymous").
- **Three screenshot → critique → fix passes** at 390×844 and 1440×900. They fixed: the first field below the fold on phones, truncated tabs, the sticky tab bar covering content on mobile, view alignment on desktop, and weak mobile field numerals.
- The admin console uses the same type and tokens, calmer and denser.
- `line` color (1.7:1) is decorative only; input borders use `ink` to meet the 3:1 non-text contrast rule.

### Front end

- **Tailwind CSS v4** over CSS modules: tokens map directly to brand CSS variables (`@theme inline`), utilities keep the dense admin UI compact, and the portal's signature pieces live in a small hand-written stylesheet (`src/portal/portal.css`). One system for both apps.
- **Two isolated Vite builds** (`vite.portal.config.ts`, `vite.admin.config.ts`) instead of one multi-entry build. A separate module graph guarantees the portal can't pull in admin code or `supabase-js`. The dev server (`vite.config.ts`) serves both and mirrors production routing.
- **Portal uses `preact/compat`** (aliased only in the portal build) while code is written against the React API. Result: ≈71 KB raw / ≈28 KB gzip JS, well under the 150 KB budget. The admin console uses React 18.
- **`zod/mini`** for shared validation: small enough for the portal, same schema used by the function.
- **Tracking codes:** 4 words from a 1,959-word list (BIP39 English, minus words that read badly on a workplace receipt) + 4 digits ≈ **57.1 bits**, from `crypto.getRandomValues` with rejection sampling. The list is copied into the repo (no runtime dependency).
- **Admin sessions in `sessionStorage`:** closing the browser signs out (stolen-laptop threat).
- **Admin export chunk** (`exceljs` + `docx`, ≈1.1 MB) is lazy-loaded on first export, so it doesn't slow normal console use.
- **Exports exclude private notes** so files can be shared. **Backups exclude photos and tracking hashes.**
- **Flyer QR** is rendered as an SVG path from the QR matrix: no `dangerouslySetInnerHTML`, no `data:` URLs, CSP stays strict.

### Server and data

- **Status and board** go through column-limited SQL functions (`portal_status`, `portal_board`), executable only by `service_role`, and the functions then allow-list fields again. Body, photo and tags can't leak by accident.
- **Privileged helpers live in a `private` schema** (not exposed by the REST API). The Supabase security advisor flagged `SECURITY DEFINER` functions in `public`; `public.is_admin`, `log_export` and `hard_delete_suggestion` are now thin `SECURITY INVOKER` wrappers. The advisor reports no warnings.
- **Column-level UPDATE grant** for admins (`admin_tag`, `status`, `public_reply`, `published_to_board`, `board_summary`, `deleted_at`): the original text, submitter tag, photo and hash are immutable even for admins.
- **`admin_tag` is NOT NULL** and starts equal to `submitter_tag`, so both are always shown and sort by priority works (`priority_tag` enum is declared in ascending urgency).
- **No `FORCE ROW LEVEL SECURITY`:** the `SECURITY DEFINER` helpers run as the table owner and must read the allow-list. Owner bypass is the standard Postgres behaviour; clients never connect as the owner.
- **Hard delete** = Storage API delete (admin delete policy on the bucket) then `hard_delete_suggestion` RPC. Supabase doesn't allow deleting storage objects from SQL. Notes cascade; the audit row records the deletion without the body.
- **Audit log written by triggers** (`SECURITY DEFINER`) so it can't be skipped; exports and backups are logged via the `log_export` RPC. No insert/update/delete policy for anyone.
- **Last-admin guard** uses a statement-level advisory lock plus an after-delete check, which also covers concurrent removals and the service role.
- **Bots get a silent fake success** (honeypot or < 3 s on form): nothing is stored and nothing tells the bot it was caught.
- **Photos: the server rejects EXIF instead of re-encoding.** Functions have no native image libraries; the browser already re-encodes through a canvas, and the server verifies magic bytes (JPEG/WebP only), size (≤1.5 MB) and absence of EXIF/XMP.
- **Portal key sent as a header** (`x-portal-key`), not a query string, so it stays out of URL-based logs.
- **Routing and admin CSP generated at build** (`scripts/postbuild.mjs` → `_redirects`, `_headers`) because they depend on env vars. Consequence: **rotating `PORTAL_KEY` requires a redeploy** (documented).
- **404 page is deliberately plain**, with no mention of the console.
- **Turnstile:** server-side verification only (`netlify/lib/turnstile.ts`), off unless `TURNSTILE_SECRET_KEY` is set. The portal widget is not wired, because it adds a third-party script; README documents how to enable it.
- **Local dev and E2E run without the Netlify CLI:** `vite.config.ts` runs the functions in-process, and `scripts/serve.mjs` serves the production build with the same routing. E2E tests the real production bundle against local Supabase.
- **Before-user-created hook** enabled in `supabase/config.toml` for local; in production it must be enabled in the dashboard (SETUP_CHECKLIST 4.1).

### Dependencies

- `npm audit`: a moderate advisory in `uuid` (transitive via `exceljs`) is fixed with an `overrides` entry (`uuid ^11.1.1`). Result: 0 vulnerabilities.
- `exceljs` (not the outdated `xlsx` package) for spreadsheets, `docx` for Word.
- `@preact/preset-vite` was skipped (peer conflict with the React plugin's Babel); plain aliases do the job.

## 2026-11-19: Two gentler priority tags

- Added **"I’m just sayin’"** (`just_sayin`) and **"Casual"** (`casual`) at the product owner's request, via a new migration (`20261119000500_more_priority_tags.sql`, `ALTER TYPE … ADD VALUE`), not by editing the original migration.
- Order (ascending urgency, which drives "sort by priority" in Postgres): just_sayin < casual < important < urgent < crucial. Form, admin chips, filters and exports all follow `TAGS` in `src/shared/domain.ts`.
- Colors: just_sayin uses a near-paper tint with a hairline, casual a muted sage. Both pass AA with ink text (checked by the brand contrast test) and come from `brand.config.ts` like the other tags.

## 2026-11-19: "HR eyes only" named reports

Product owner asked for a named section for personal issues. Choices confirmed in the interview:
- **Separate section**, not a category: a switch at the top of the portal form. The HR form says it is not anonymous before anything is typed, and the wall label changes to "Named · HR only". The anonymous form is unchanged.
- **Only an HR list can read them**: new `hr_staff` allow-list and `private.is_hr()`. RLS gives admins no access to `hr_reports`/`hr_notes`/`hr_staff`. HR manages its own list (first member via SQL), so admins can't grant themselves access from the console. A last-HR-member guard prevents lockout.
- **Fields**: name required (2–120), contact optional (≤200), body 10–4000, **no photo** (keeps the named path simple and avoids image metadata on identified reports).
- **Exposure**: never on the board or in the general exports/backup; HR has its own Excel export and JSON backup, both audited. Audit rows for HR actions (`hr_*`) carry no names, contact details or text. Admins see those rows (action, actor, time); HR sees only `hr_*` rows.
- Separate table (not a flag on `suggestions`) so the anonymous table keeps zero identity columns and its tests still prove that.
- Same `/api/submit` endpoint with `mode=hr` (the portal still talks to exactly three functions); `portal_status` now looks in both tables and returns the same three fields.
- The before-user-created hook now allows emails on either the admin list or the HR list.
- Known gap: the HR Excel export has no filter-summary row (the anonymous export does).

## 2026-11-19: Product name

- Default product name changed to **Dispatch Bro** (`brand.config.ts` → `appName`; package name `dispatch-bro`). The local Supabase `project_id` in `supabase/config.toml` stays `dispatch-buddy`: it only names local Docker containers and changing it means restarting the local stack.

## 2026-11-19: Email + password sign-in with recovery

- Admin and HR sign-in now offers **email + password** (primary) alongside Google, at the product owner's request.
- **Who can have an account:** unchanged. The before-user-created hook only admits emails on the admin or HR list, so "First time? Create your password" works only for people an admin (or HR) has already added.
- **Confirmation required** before a password works; passwords need 12+ characters with letters and digits; changing a password needs a recent sign-in and sends a notification email.
- **Recovery:** "Forgot password?" sends a one-time link. Email templates use `token_hash` + `verifyOtp` on `/auth/confirm` instead of PKCE, because PKCE links fail when opened in a different browser (the code verifier lives in the requesting tab's `sessionStorage`). Lost email/Google account → another admin replaces the email. Total lockout → break-glass SQL (SETUP_CHECKLIST 4.5).
- **No account enumeration:** all three forms answer generically.
- Auth state callback work is deferred with `setTimeout` to avoid a supabase-js auth-lock deadlock when real sign-in events fire.
- Production depends on custom SMTP; Supabase's built-in mailer is restricted and rate-limited.
- Local E2E reads real emails from Mailpit (`supabase start` now includes it; local `email_sent` limit raised to 60/hour, local only).

## 2026-11-20: Phase 2, dispatch board

**Checkpoint 1 answers:** default lists approved (job types, statuses, handling flags, skills, certifications, checklist, asset kinds); crew sign in with email + password or Google (no SMS codes: per-code cost plus A2P 10DLC registration not worth it yet); no assignment emails in Phase 2 (notifications come with the SMS phase); crew can see **all teammates' phone numbers** on their own jobs.

**Checkpoint 2:** UI approved as built; the 24-hour "checklist open" warning stays as written.

- **Roles:** `staff_roles` (admin · dispatcher · viewer · crew, one per email). `public.admins` stays a **real table** and the source of truth for admin, mirrored both ways into `staff_roles` by triggers. Reason: a compatibility *view* can't take `upsert` (`ON CONFLICT`), which Phase 1 code and tests use, and keeping the table means `private.is_admin()` is literally unchanged. Last-admin guard runs on both tables.
- `private.current_role()` is named **`private.current_staff_role()`** because `CURRENT_ROLE` is a reserved SQL word. `private.has_role(variadic text[])` is as specified; `is_office()` / `is_dispatcher()` are shorthands.
- **Crew access only through definer functions** with explicit field lists, instead of column grants on shared tables: RLS is row-level, and a crew policy on `jobs` would expose `office_notes`. Office roles read tables directly (so Realtime works for them).
- **Client name hidden from crew** (treated as billing context); dispatchers can add what crew need to the job title or crew notes.
- **Skills** use a join table (`crew_skills`) with a foreign key to the editable `skills` lookup; certifications use `certification_types`. Handling, access and asset-capability flags are fixed lists validated by CHECK (labels live in `src/shared/dispatch.ts`).
- **Office time zone** in `app_settings` (default `America/Los_Angeles`) drives day boundaries in SQL and all dispatch display/input in the UI.
- **Job numbers** `J-YYYY-NNNN` from one sequence (the year is the creation year; the counter doesn't reset yearly).
- **Optimistic locking:** `jobs.version` bumped by trigger; the client updates `where version = <loaded>` and shows "someone else changed this job" if 0 rows change.
- **Conflict rules** live in `private.job_conflicts_raw()` (one place for UI and tests): `job_conflicts(job)`, `board_conflicts(from, to)`, and `record_conflict_override(job, reason)` (3–500 chars, audited with a snapshot of the warnings). "Missing skill" means: handling flags need an art handler; install/de-install need an installer; crating needs a crater; any truck/van/trailer needs a driver. "Expired certification" covers driver's license (vehicle + driver skill), CDL (asset marked requires_cdl), forklift and aerial lift (matching asset capability).
- **Never hard-delete history:** `job_assignments` and `job_assets` use `on delete restrict` for crew and assets (deactivate instead); incident reports block job hard delete (use trash).
- **Incident photos** go through a Netlify function (`/api/incident-photo`) that verifies the user's token, checks permission as that user, re-checks magic bytes/size/EXIF, then stores with the service key, the same pattern as the portal. Max 4 photos per incident.
- **Audit:** every dispatch table has a trigger writing `dispatch_<table>_<op>` rows (plus `dispatch_jobs_status`, `dispatch_jobs_soft_delete`, `dispatch_conflict_override`, `dispatch_export`, `dispatch_role_*`). The Audit page filters by module. Audit stays admin-only (dispatchers don't see it).
- **Realtime** on `jobs`, `job_assignments`, `job_assets`, `time_off`; the board debounces and reloads.
- **Drag and drop:** `@dnd-kit/core` with keyboard sensor and screen-reader announcements, plus an Assign… menu on every card. Moving crew between jobs is assign-then-unassign (two calls), with rollback on error.
- **SMS prep only:** phones stored in E.164 with consent timestamp/method; `call_time`, `call_location` and per-person `call_time_override`; `buildJobSummary(job, { forCrewMember })` in `src/shared/dispatch.ts` is the plain text the print sheet uses now and SMS will use later. **No texts are sent.**
- Known limits: the brand header prints only on the first page of a multi-page day sheet; hard-deleting a job with incidents is refused (use trash).
- **Checkpoint 3 (2026-11-20):** the access model above is approved for production. Initially only the product owner (admin + HR); dispatchers, viewers and crew are added later in Dispatch → Staff roles. The product owner runs the production migration after merge (`npx supabase db push --remote`).
- CI starts Supabase Realtime (it was excluded), so the two-browser live-update test runs there too.
- Fixed in passing (Phase 1): the success-screen tag animation widened the page to 481px on 390px phones; clipped, with a regression check.

## 2026-11-20: Product renamed to Air Ride Op

- `appName` in `brand.config.ts` is now **Air Ride Op** (package name `air-ride-op`); docs updated. Earlier DECISIONS entries keep the old names as history. The local Supabase `project_id` (`dispatch-buddy`) is unchanged: it only names local Docker containers.
- The GitHub repo and the Netlify site (`dispatch-bro-app.netlify.app`) are **not** renamed. To move to a new `*.netlify.app` name later: Netlify → Project configuration → Change project name; then Supabase → Authentication → URL Configuration (Site URL + the `/auth/callback` and `/auth/confirm` redirect URLs); Google OAuth client authorized origin (if Google sign-in is used); and reprint the flyer (the QR code holds the old URL). The old URL stops working immediately.
