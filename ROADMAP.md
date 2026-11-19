# Roadmap

Phase 1 (the anonymous suggestion box) is built. The phases below are **not built yet**; the Phase 1 architecture is designed not to block them.

## Phase 2: Dispatch board

- Add, edit and delete truckers/handlers, and drag and drop them onto jobs.
- Pair crews with job details.
- New tables in the same Supabase project.
- Role-based sign-in (**admin / dispatcher / viewer**) that extends the `admins` table into a roles model.

## Phase 3: Estimates

- Quick estimates for clients: shipping, crating, sculpture removal, crew size, and total job.
- All rates live in **admin-editable rate tables**, never hardcoded.
- Itemized line items, and PDF and Word quote export.

## Phase 4: Industry news and opportunities

- An art-logistics and art-world news feed.
- Alerts for upcoming exhibitions, installs and transport opportunities.

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
