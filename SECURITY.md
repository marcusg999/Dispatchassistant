# Security and privacy

Air Ride Op Phase 1 is an anonymous suggestion box plus a private admin console. Privacy for submitters and access control for the console are product features, not afterthoughts. This document describes what we protect, against whom, how, and what risk remains.

## What we promise submitters, exactly

> "Your name is never asked for or stored. Management sees only what you write."

**Exception, clearly separated: "HR eyes only".** The portal has a second, opt-in section for personal issues that is **not anonymous**: it requires a name (contact optional) and says so before anything is typed. Those reports go to a separate table, `hr_reports`, that only the HR list (`hr_staff`) can read: admins cannot, which the database enforces with RLS. The anonymous `suggestions` table still has no identity columns. HR reports never appear on the board or in the general exports or backup, and their audit rows record actions only: no names, contact details or text.

We do **not** claim submissions are untraceable. Writing style, timing, specific details and photos can point to a person, and hosting platforms keep their own operational logs (see "Residual risks").

---

## Threat model

### 1. A curious coworker or manager trying to find out who wrote something

| Control | Where |
| --- | --- |
| No name, email, phone, employee ID or login is ever asked for | `src/portal/SubmitForm.tsx` (form fields), `src/shared/validation.ts` (schema has no identity fields; a unit test asserts the exact field list) |
| The `suggestions` table has **no** column for identity, IP or user-agent | `supabase/migrations/20261119000100_schema.sql`; integration test checks the columns |
| The submit function never stores or logs IP, user-agent, body text or tracking hashes | `netlify/functions/submit.mts`, `netlify/lib/http.ts → logEvent`; test captures console output and asserts no body or hash appears |
| No cookies, analytics, third-party scripts or fonts on the portal; everything self-hosted; CSP `default-src 'self'` | `netlify.toml` (`/s/*` CSP), self-hosted Archivo font |
| No browser storage, except an opt-in "remember my code on this device" toggle, off by default | `src/portal/storage.ts` |
| Tracking codes: only `SHA-256(code)` leaves the device; the plain code is never sent or stored | `src/shared/tracking.ts` |
| Photos are re-drawn on a canvas in the browser (drops EXIF/GPS, camera serial, timestamps), downscaled to ≤1600 px and ≤1.5 MB. The server re-checks magic bytes and size and **rejects** any file that still carries EXIF/XMP | `src/portal/photo.ts`, `netlify/lib/image.ts`; E2E test uploads a GPS-tagged JPEG and proves the stored object has no EXIF/GPS |
| Photo object names are random UUIDs; nothing about the submitter is in the path | `submit.mts`, `photo_path_fmt` CHECK |
| On-form guidance: "Very specific details can sometimes point to who wrote something…" and "Photos can sometimes show who took them…" | portal form |
| Hard delete erases body, photo and notes; the audit row for it keeps no body | `private.tg_suggestions_audit`, `src/admin/data.ts → hardDelete` |

### 2. A leaked portal link

| Control | Where |
| --- | --- |
| The portal lives at a secret path `/s/<PORTAL_KEY>`; every other path is a plain 404 that doesn't hint at the console | `scripts/postbuild.mjs` (`_redirects`), `public/404.html` |
| All three APIs require the key (constant-time compare) and return 404 without it | `netlify/lib/http.ts → hasValidPortalKey` |
| A link holder can only submit, check a status by code, and read the public board. No other data is reachable | function allow-lists, column-limited `portal_status` / `portal_board` |
| **Rotation:** change `PORTAL_KEY` in Netlify and redeploy. The old path 404s and the APIs reject the old key. Tracking codes keep working | README → "Rotate PORTAL_KEY" |

### 3. A stolen or lost admin laptop

| Control | Where |
| --- | --- |
| Admin sessions are kept in `sessionStorage`: closing the browser signs out | `src/admin/supabase.ts` |
| Sign-in is email + password (12+ chars, letters and digits, email-confirmed) or Google. Google accounts bring their own 2-step verification: **require it on admin Google accounts**. Password changes trigger a notification email; changing a password requires a recent sign-in | SETUP_CHECKLIST 4.2 |
| Lost password: one-time, one-hour reset link to the account's email. Lost email: another admin swaps the address. Lockout: break-glass SQL by the project owner | README → Sign-in and account recovery |
| Any admin can remove a compromised admin instantly (Admin → Admins); RLS stops access on the next request | `admins` table, `private.is_admin()` |
| Revoke sessions: Supabase → Authentication → Users → the user → sign out / delete user | dashboard |
| Every admin action is in an append-only audit log (who, what, before/after, when) | `audit_log`, triggers |
| Optional session inactivity timeout in Supabase Auth settings, where the plan allows | SETUP_CHECKLIST 4.4 |
| No secret key in the browser; the console uses the publishable key plus the admin's session under RLS | `src/admin/supabase.ts` |

### 4. Spam and abuse

| Control | Where |
| --- | --- |
| Honeypot field; filled → silent fake success, nothing stored | `SubmitForm.tsx`, `submit.mts` |
| Minimum time on form (~3 s); faster → silent fake success | `MIN_FORM_MS`, `submit.mts` |
| zod validation on client and server; DB CHECK constraints (length, enums, hash format, photo path) as the last line | `src/shared/validation.ts`, migrations |
| Request size cap (~1.56 MB), multipart only, same-origin check, no CORS headers | `submit.mts`, `http.ts` |
| Duplicate tracking hash (replay) refused without revealing anything | `submit.mts` (409) |
| Netlify platform rate limits declared per function (submit 10/min per IP) | function `config.rateLimit`; activity depends on plan, see DECISIONS.md |
| Optional Cloudflare Turnstile (off by default) | `netlify/lib/turnstile.ts`, README |
| Key rotation as a last resort | README |

### 5. A Google account that isn't an admin tries to sign in

| Control | Where |
| --- | --- |
| **Before-user-created auth hook** refuses to create a user for any email not in `public.admins` | `public.hook_before_user_created`; RLS test calls signup and expects refusal |
| Even if a user exists (e.g. a removed admin), RLS returns nothing: every policy requires `private.is_admin()`, which compares the JWT email with the allow-list | `20261119000200_security.sql`; RLS tests as a non-admin |
| The console's "not allowed" screen is UX only; the database enforces access | `src/admin/App.tsx` |

### 6. Accidental identification

| Risk | Mitigation |
| --- | --- |
| Very specific details in the text | On-form tip; admins should not repeat identifying details in replies or board summaries |
| Photos (faces, reflections, a specific truck or bench) | On-form note; EXIF stripped; photos only ever shown to admins via 5-minute signed URLs; never published |
| Board posts | The board shows **only** an admin-written summary, category, status and date, never the original text or photo. The console reminds admins to avoid identifying details |
| Exports and backups | Exports exclude private notes; backups exclude photos and tracking hashes. Both are audited. Treat downloaded files as sensitive |

---

### Password guessing and account discovery

| Control | Where |
| --- | --- |
| Only allow-listed emails can ever have an account (before-user-created hook), so guessing needs a real admin email | migrations |
| Supabase Auth rate-limits sign-in, sign-up and email sending per IP | Supabase platform |
| Sign-in, sign-up and reset show generic messages that don't reveal whether an email is on the list | `src/admin/pages/SignIn.tsx` |
| Email links use one-time `token_hash` values that are removed from the address bar after use | `src/admin/pages/AuthConfirm.tsx` |
| Sessions live in `sessionStorage` and end when the browser closes | `src/admin/supabase.ts` |

Residual: a phished admin password works until it's changed. Prefer Google with 2-step verification for admins who can use it, and keep the admin list short.

### 7. Phase 2: a curious crew member

Crew have **no direct access to any table**. They read and write only through four functions (`my_jobs`, `crew_set_checklist`, `crew_report_incident`, `my_incidents`) that return their own assigned jobs with an explicit list of fields: no office notes, client name, other jobs, roster, audit log, suggestions or HR. Teammates' names and phones on the same job are shown (product decision). Crew can tick a checklist only as team lead of that job, and file incidents only on their own jobs. Incident reports are **named**, and the form says so.

### 8. Phase 2: a viewer trying to write

Viewers get read policies only. Every insert, update and delete on dispatch tables requires `private.is_dispatcher()` (admin or dispatcher), and hard-deleting jobs requires admin. Managing roles requires admin. Tests prove each of these per role.

### 9. Phase 2: crew and the suggestion box

The anonymous box stays exactly as private as before:
- New roles grant nothing on `suggestions`, `admin_notes`, `hr_*` or their storage (policies there still check `is_admin()` / `is_hr()` only).
- No foreign keys from dispatch tables into suggestion or HR tables.
- The portal is still a separate, sessionless build with no Supabase client. An E2E test signs a crew member in, then uses the portal in the same browser and proves the portal never reads auth storage and never sends an `Authorization` header; the stored suggestion has no link to the signed-in user.
- Nothing in the dispatch module records who visited the portal.

### 10. Phase 3: pricing confidentiality

- Only **admin** and **estimator** can read clients, rate cards, rules, terms, estimates, lines, quote links or acceptances (`private.is_estimating()` in every policy). Dispatchers, viewers, crew, HR and anon get nothing; tests prove it per role and table.
- Only admins edit rate cards, rules and terms; only **draft** cards can be edited (activate with an effective date; terms are immutable versions).
- Signed-in users can change an estimate's **inputs** only (column grants). Totals, lines, status, approvals, the rate snapshot, links and acceptances are written only by the server functions through `server_*` database functions callable by the service role alone, which also record the real actor in the audit log.
- The server re-prices with the shared engine and rejects any client-submitted total that doesn't match. Approval is voided if the price changes after approval.
- Converted jobs carry no prices: only the estimate number and accepted date.

### 11. Phase 3: quote links

| Threat | Control |
| --- | --- |
| Guessing a link | 128-bit random token; only its SHA-256 is stored; rate-limited API |
| A forwarded or leaked link | Expires with the quote; revoke anytime; sending again or revising retires the old link |
| Old revision accepted after a new one was sent | Refused with a pointer to the latest link |
| Tampered totals in the database | Every view and acceptance re-prices from the snapshot and refuses on mismatch |
| Probing links | Expired, revoked, unknown and malformed tokens all return the same message |
| Internal data leaking to clients | The API returns an explicit field list: no costs, margins, traces, internal notes or staff emails (tested with a deep key scan) |
| Session leakage | The quote page is a separate sessionless build (no Supabase client, no storage); E2E proves no `Authorization` header or auth storage access with an office session in the same browser |

### 12. Phase 3: acceptance records

Acceptance is a **named business record**, not anonymous, and the page says so before submitting: name, title, email, typed signature (must match the name), terms version, total, time, IP address and browser are stored in `quote_acceptances`. One acceptance per estimate. This is a simple click-to-accept record; for contracts that need a qualified e-signature, use a dedicated e-signature service.

## Controls summary

- **CSP per area.** Portal (`/s/*`): `default-src 'self'`, `connect-src 'self'`, no third parties. Admin (`/admin`, `/admin/*`, `/auth/callback`, `/auth/confirm`): same, plus only this project's Supabase origin in `connect-src` / `img-src` (generated into `_headers` at build). APIs: `default-src 'none'`.
- **Headers** on everything (`netlify.toml`): HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, COOP/CORP same-origin, restrictive `Permissions-Policy`, `X-Robots-Tag: noindex`.
- **Same-origin APIs, no CORS.** No `Access-Control-Allow-Origin` anywhere; cross-origin POSTs are rejected.
- **No `dangerouslySetInnerHTML`**, no inline scripts or styles (the flyer QR is rendered as an SVG path).
- **Secrets only in Netlify env vars.** `.env.example` has no values. The secret key is used only in `netlify/functions` via `netlify/lib/db.ts`.
- **Build guard** (`scripts/check-dist.mjs`): fails the build if `dist/` contains the secret key, any `sb_secret_…` key, a `service_role` JWT, the portal key (outside `_redirects`, which Netlify never serves), or any Supabase/admin code in the portal bundle.
- **Database:** RLS on every table; table privileges revoked from `anon`/`authenticated` and re-granted minimally; `TRUNCATE` revoked; **column-level UPDATE grant** so admins can change only triage fields (body, original tag, photo and hash are immutable); privileged helpers in a `private` schema that the REST API doesn't expose; note author forced from the session.
- **Append-only audit log:** written by `SECURITY DEFINER` triggers and RPCs; no insert/update/delete policy for anyone.
- **Last-admin guard:** statement-level lock + after-delete check, so the allow-list can never become empty, even with concurrent removals or the service role.
- **Storage:** private bucket, only the server uploads, admins read via signed URLs (≤5 minutes) and can delete.
- **Supabase security advisor (splinter):** no warnings.
- **Dependencies:** `npm audit` reports 0 vulnerabilities (a `uuid` override fixes a transitive advisory in `exceljs`). Dependabot and GitHub secret scanning are enabled per SETUP_CHECKLIST.

---

## Residual risks (honest list)

- **Platform logs.** Netlify and Supabase edge/proxy infrastructure may record client IP addresses and request metadata in their own operational logs, and Netlify's rate limiter counts requests per IP. We don't store or log these, and we don't control those platform logs or their retention.
- **Network context.** Submitting from the shop Wi-Fi or a company phone could be visible to whoever runs that network or device. Using a personal phone on mobile data is the most private option.
- **Writing style and timing.** A distinctive way of writing, or a submission right after a specific incident, can point to a person.
- **Tracking hash.** The database stores an unsalted SHA-256 of a ~57-bit random code. Someone with a copy of the database could, with very large compute, brute-force codes back from hashes. The prize would only be the ability to check that suggestion's status and reply, which admins can already see. No identity is linked to a code. We accept this risk for simplicity; adding a server-side pepper (HMAC) would raise the cost further if ever needed.
- **Admins.** Anyone on the admin list can read every submission. Keep the list short and review it in Admin → Admins.

---

## Reporting a vulnerability

If you find a security or privacy problem, contact the maintainers of this deployment (the office team that runs it) privately, not through the suggestion box or a public issue. Include steps to reproduce. Please don't access other people's data while testing.
