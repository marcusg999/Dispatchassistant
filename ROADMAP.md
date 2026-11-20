# Roadmap

**Phase 1** (suggestion box, HR eyes only, sign-in with recovery), **Phase 2** (dispatch board) and **Phase 3** (estimates and quotes) are built. Phase 4 and the future items are **not built yet**.

## Phase 2: Dispatch board ✅ built

See README → Dispatch board. Roles admin / dispatcher / viewer / crew; day board with drag and drop, week view, job editor, crew/assets/time off, conflict warnings, crew My jobs, named incidents, printable sheets.

Original brief:

- Add, edit and delete truckers/handlers, and drag and drop them onto jobs.
- Pair crews with job details.
- New tables in the same Supabase project.
- Role-based sign-in (**admin / dispatcher / viewer**) that extends the `admins` table into a roles model.

## Phase 3: Estimates ✅ built

See README → Estimates and quotes, and `docs/ESTIMATE_EXAMPLE.md`.

Original brief:

- Quick estimates for clients: shipping, crating, sculpture removal, crew size, and total job.
- All rates live in **admin-editable rate tables**, never hardcoded.
- Itemized line items, and PDF and Word quote export.

## Phase 3 notes from Phase 2

- An accepted estimate converts into a Phase 2 job and reuses `job_items` (inches and pounds, validated). Add a `clients` table then (jobs currently have plain-text `client_name`).
- Rates must live in admin-editable tables (dimensional-weight divisor, packing padding, distance tiers, insurance, surcharges, add-ons).

## Phase 4: Industry news and opportunities

Opportunities could later link to a client and a draft estimate.

- An art-logistics and art-world news feed.
- Alerts for upcoming exhibitions, installs and transport opportunities.

## Future: automatic mileage (not built)

Look up miles per leg from addresses with a maps API (key server-side, cached), keeping the manual override. Estimate stops already store `miles_from_previous` per leg.

## Future: SMS dispatch (not built)

From a job or the day board, text the people on that job their job info, crew list, truck and call time. Preview and confirm, per-person call times, resend on change, delivery status, STOP/HELP handling, only crew with `sms_opt_in`, every send audited. Likely Twilio or similar via a Netlify Function (key server-side), with US A2P 10DLC registration. Phase 2 already stores E.164 phones with consent, call times with per-person overrides, and `buildJobSummary()` for the message text.

## Throughout

- White-label only: all names, colors and copy come from `src/brand/brand.config.ts`.
- The app never shows the names of outside reference companies, museums or publications.
- Only the suggestion box is anonymous; every new module requires sign-in.

---

## How Phase 1 leaves room

- **Roles:** access is centralized in `private.is_admin()`, used by every RLS policy. Phase 2 can add a `role` column (or a `user_roles` table) next to `admins` and introduce `private.has_role(...)`, keeping `is_admin()` as `has_role('admin')`. Policies for new tables use the new function; existing ones keep working.
- **Data:** new modules get their own tables and migrations in the same project, with RLS on from the first migration. The suggestion box tables stay isolated (no foreign keys from new modules into `suggestions`).
- **Console shell:** the admin app already has a header nav and a small router (`src/admin/router.tsx`, `src/admin/App.tsx`). New modules add routes and nav items under `/admin/...`, behind the same Google sign-in.
- **Audit:** `private.audit()` and the `audit_log` table are generic (actor, action, before/after); new modules can log through the same path.
- **Exports:** `src/admin/exporters.ts` already produces branded `.xlsx` and `.docx`; Phase 3 quotes can reuse the same approach (plus a PDF route).
- **Branding:** new screens read colors and copy from `brand.config.ts` and Tailwind tokens, so a rebrand still means editing one file.
- **Portal isolation:** the public portal is a separate build with its own entry. Signed-in modules never need to touch it, and its no-Supabase guard stays in place.
