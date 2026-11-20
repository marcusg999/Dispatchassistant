# Setup checklist (production)

Manual, one-time steps to take Air Ride Op live at **https://dispatch-bro-app.netlify.app**. Do them in order. Dashboard menu names change from time to time; if a label differs slightly, look for the closest match.

> **To confirm before go-live: the first admin email(s).** Everywhere below that says `FIRST_ADMIN@example.com`, use the Google account email(s) that should run the console.

You'll collect these values along the way. Keep them in a password manager, never in chat or a committed file:

| Value | Where it comes from | Used in |
| --- | --- | --- |
| Project ref | Supabase project URL `https://<ref>.supabase.co` | CLI link, Google redirect URI |
| Project URL | Supabase → Settings → API Keys / Data API | `SUPABASE_URL`, `VITE_SUPABASE_URL` |
| Publishable key (`sb_publishable_…`) | Supabase → Settings → API Keys | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Secret key (`sb_secret_…`) | Supabase → Settings → API Keys | `SUPABASE_SECRET_KEY` (functions only) |
| Google client ID + secret | Google Cloud → Credentials | Supabase Google provider |
| Portal key | You generate it (step 6.2) | `PORTAL_KEY` |

---

## 1. Create the Supabase project

1. Go to supabase.com → sign in → **New project**.
2. Pick your organization, name it (e.g. `air-ride-op`), set a strong database password (save it), choose the region closest to the crews, plan **Free**.
3. Click **Create new project** and wait until it says it's ready.
4. Copy the **project ref**: it's the `<ref>` in the project URL `https://<ref>.supabase.co` (also under Settings → General).

## 2. Link the CLI and push migrations

From a local clone of the repo:

```bash
npm ci
```

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <your-project-ref>
```

(Enter the database password when asked.)

```bash
npx supabase db push
```

This creates every table, policy, trigger, function and the private `suggestion-photos` bucket. Never create or change schema by clicking in the dashboard; always add a migration and `db push`.

## 3. Insert the first admin

1. Supabase → **SQL Editor** → **New query**.
2. Run (one row per admin):
   ```sql
   insert into public.admins (email) values ('FIRST_ADMIN@example.com');
   ```
3. Check: `select * from public.admins;` shows the email in lowercase.

More admins can be added later from the console (Admin → Admins).

4. Add the first **HR** member (the only people who can read "HR eyes only" reports; admins can't). It can be the same person as an admin or someone else:
   ```sql
   insert into public.hr_staff (email) values ('FIRST_HR@example.com');
   ```
   After that, HR members manage the HR list themselves in the console (HR team page). Admins can't see or change it.

## 4. Supabase Auth settings

### 4.1 Before User Created hook (only allow-listed emails can become users)

1. **Authentication** → **Hooks** (may be listed as "Auth Hooks").
2. **Add hook** → **Before User Created**.
3. Hook type **Postgres**, schema **public**, function **`hook_before_user_created`**.
4. Enable and **Save**.

### 4.2 Providers: email + password, and Google

Admins (and HR) can sign in with **email + password** or with **Google**. Only emails on the admin or HR list can ever get an account (the hook in 4.1).

1. **Authentication** → **Sign In / Providers**.
2. **Email**: keep it **on**, and turn **Confirm email** **on** (a new password only works after the emailed link is opened). Leave **Secure email change** on.
3. Same page, password settings: **Minimum password length** `12`, **Password requirements** "Letters and digits". Turn on **Secure password change**. (Leaked-password protection is a paid-plan option; turn it on if you upgrade.)
4. Make sure **Allow new users to sign up** stays on (the hook does the allow-listing).
5. **Google**: you'll come back here in step 5.4 to paste the client ID and secret. Google is optional; skip section 5 if everyone will use email + password.

### 4.2a Email delivery (needed for confirmations and password resets)

Supabase's built-in email only delivers to members of your Supabase organization and is heavily rate-limited, so password-reset and confirmation emails won't reliably reach admins without your own SMTP.

1. Create an account with any transactional email provider that offers SMTP (many have a free tier) and verify a sending domain or address.
2. Supabase → **Authentication** → **Emails** → **SMTP Settings** → enable custom SMTP and enter the host, port, user, password, sender email and sender name (for example, the app name).
3. Send yourself a test: on the sign-in page use **Forgot password?** with an admin email and check the inbox.

### 4.2b Email templates (links that work on any device)

Supabase → **Authentication** → **Emails** → **Templates**. Replace the body of these templates with the files in `supabase/templates/` (the subjects are in `supabase/config.toml`):

| Template | File |
| --- | --- |
| Confirm signup | `supabase/templates/confirmation.html` |
| Reset password | `supabase/templates/recovery.html` |
| Password changed (notification; enable it) | `supabase/templates/password_changed_notification.html` |

These templates send a one-time `token_hash` link to `/auth/confirm`, which works even if it's opened in a different browser or on a phone.

### 4.3 URL configuration

1. **Authentication** → **URL Configuration**.
2. **Site URL**: `https://dispatch-bro-app.netlify.app`
3. **Redirect URLs**: add both:
   - `https://dispatch-bro-app.netlify.app/auth/callback`
   - `https://dispatch-bro-app.netlify.app/auth/confirm`
   - `http://localhost:5173/auth/callback`
   - `http://localhost:5173/auth/confirm`
4. **Save**.

### 4.4 Recommended: session limits

Authentication → **Sessions**: if your plan offers it, set an **inactivity timeout** (e.g. 8h) and/or **time-box**. The console already stores sessions in `sessionStorage`, so closing the browser signs the admin out.

### 4.5 Break-glass recovery (if every admin is locked out)

Normal recovery: **Forgot password?** on the sign-in page, or another admin replaces a lost email on the Admins page. If nobody can sign in at all, the Supabase project owner can:

1. Supabase → **SQL Editor** → run `insert into public.admins (email) values ('new-email@example.com');` (use `public.hr_staff` for HR).
2. On the sign-in page, choose **First time? Create your password** with that email and open the confirmation link.
3. Remove any address that's no longer valid from the Admins page.

Keep at least two admins (and two HR members) so this is rarely needed.

## 5. Google Cloud OAuth client (optional)

1. Go to console.cloud.google.com → project picker → **New project** (e.g. `air-ride-op-auth`) → **Create** → select it.
2. **APIs & Services** → **OAuth consent screen** (may appear as "Google Auth Platform → Branding/Audience"):
   - If admins all use one Google Workspace domain: user type **Internal**.
   - Otherwise: **External**, then under **Audience/Test users** add each admin's Google email (or publish the app).
   - App name: the brand app name (no company name required). Support email: an office address. Scopes: the defaults (`openid`, `email`, `profile`) are enough. Save.
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**:
   - Application type: **Web application**, name `Supabase`.
   - **Authorized JavaScript origins**:
     - `https://dispatch-bro-app.netlify.app`
     - `http://localhost:5173`
   - **Authorized redirect URIs**:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - **Create**, then copy the **Client ID** and **Client secret**.
4. Back in Supabase → **Authentication** → **Sign In / Providers** → **Google** → enable, paste Client ID and Client secret → **Save**.

## 6. API keys and portal key

1. Supabase → **Settings** → **API Keys**. Copy the **publishable** key (`sb_publishable_…`) and create/copy a **secret** key (`sb_secret_…`). Copy the project URL (`https://<ref>.supabase.co`).
2. Generate the portal key (16–128 URL-safe characters):
   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

## 7. Netlify site

1. app.netlify.com → **Add new project** → **Import an existing project** → **GitHub** → authorize → pick the repository.
2. Branch to deploy: `main`. Build settings come from `netlify.toml` (build command `npm run build`, publish directory `dist`, functions `netlify/functions`), so leave the fields as detected.
3. Before the first deploy (or right after it, then redeploy): **Project configuration** → **Environment variables** → **Add a variable** for each:

   | Key | Value | Scopes | Secret? |
   | --- | --- | --- | --- |
   | `PORTAL_KEY` | from step 6.2 | Builds + Functions | Yes |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` | Functions | No |
   | `SUPABASE_SECRET_KEY` | `sb_secret_…` | **Functions only** | **Yes** |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | Builds | No |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Builds | No |
   | `KEEP_ALIVE_ENABLED` | leave unset (on). Set `false` only on a paid Supabase plan | Functions | No |

   `PORTAL_KEY` needs the Builds scope because the secret path is written into `_redirects` during the build.
4. **Project configuration** → **General** → **Project details** → **Change project name** → `dispatch-bro-app` (gives `https://dispatch-bro-app.netlify.app`).
5. **Deploys** → **Trigger deploy** → **Deploy project**. The build fails on purpose if `PORTAL_KEY` or `VITE_SUPABASE_URL` is missing, or if a secret is found in `dist/`.

## 8. Verify

- [ ] `https://dispatch-bro-app.netlify.app/s/<PORTAL_KEY>` shows the portal.
- [ ] `https://dispatch-bro-app.netlify.app/` and `/s/anything-else` return a plain 404.
- [ ] Submit a test suggestion, save the tracking code, check it under **Check status**.
- [ ] `https://dispatch-bro-app.netlify.app/admin` → **Continue with Google** with `FIRST_ADMIN@example.com` → the test suggestion is in the inbox.
- [ ] Sign in with a Google account that is **not** an admin → refused ("This account isn't allowed to sign in").
- [ ] Netlify → **Logs** → **Functions** → `submit`: lines say only `accepted` / `dropped`, never message text or codes.
- [ ] Netlify → **Functions** shows `keep-alive` as a scheduled function.
- [ ] Delete the test suggestion (Detail → Delete permanently).

## 9. Rate limiting

Rate limits are declared in each function's `config.rateLimit` (submit: 10 requests/minute per IP; status and board: 60/minute). Check **Project configuration** → **Rate limiting** (or the function's details) to see whether Netlify shows them as active. On the Free/Starter plan availability may be limited. If it isn't active, the portal key, honeypot, minimum time-on-form, validation and DB constraints still apply. Record the result in `DECISIONS.md`.

## 10. GitHub repository settings

1. **Settings** → **Code security** (or "Advanced Security"):
   - **Secret scanning**: Enable. **Push protection**: Enable.
   - **Dependabot alerts**: Enable. **Dependabot security updates**: Enable.
   - Version updates are configured by the committed `.github/dependabot.yml`.
2. Optional: **Settings** → **Branches** → protect `main` (require PR + passing checks).

## 11. Supabase security advisor

Supabase → **Advisors** → **Security Advisor** → run. Expect **no warnings**. (Informational "unused index" notices under the Performance advisor are normal on a new project.) If anything appears, fix it with a new migration, not in the dashboard.

## 11a. Phase 2: dispatch board

1. Pull `main` and push the new migrations (`npx supabase db push --remote`). They add roles, dispatch tables, conflict checks and the private `incident-photos` bucket. Existing Phase 1 data and admins are kept (admins are copied into `staff_roles`).
2. **Realtime:** the migration adds `jobs`, `job_assignments`, `job_assets` and `time_off` to the `supabase_realtime` publication. Check Supabase → **Database → Publications → supabase_realtime** lists them. Realtime respects RLS, so each person only receives changes they're allowed to read.
3. **Office time zone:** if you're not in Pacific time, run `update public.app_settings set value = 'America/New_York' where key = 'timezone';` (use your IANA zone).
4. **Assign roles:** sign in as an admin → **Dispatch → Staff roles** → add dispatchers, viewers and crew.
5. **Invite crew:** add each crew member under **Dispatch → Crew** with the same email as their role, then ask them to open `https://dispatch-bro-app.netlify.app/admin` → **First time? Create your password**. (Needs the email service from step 4.2a.)
6. **Netlify:** no new environment variables. The incident-photo function reuses `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY`; make sure `VITE_SUPABASE_PUBLISHABLE_KEY` also has the **Functions** scope.
7. Run the Supabase security advisor again (section 11): it should show no warnings.

## 12. Print and share

1. Admin → **Backup & flyer** → paste the portal link → **Print flyer** (or "Save as PDF").
2. Post flyers in the shop and the break room; share the link where crews already talk.
