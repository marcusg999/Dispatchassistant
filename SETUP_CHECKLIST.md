# Setup checklist (production)

Manual, one-time steps to take Dispatch Buddy live at **https://dispatch-bro-app.netlify.app**. Do them in order. Dashboard menu names change from time to time; if a label differs slightly, look for the closest match.

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
2. Pick your organization, name it (e.g. `dispatch-buddy`), set a strong database password (save it), choose the region closest to the crews, plan **Free**.
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

## 4. Supabase Auth settings

### 4.1 Before User Created hook (only allow-listed emails can become users)

1. **Authentication** → **Hooks** (may be listed as "Auth Hooks").
2. **Add hook** → **Before User Created**.
3. Hook type **Postgres**, schema **public**, function **`hook_before_user_created`**.
4. Enable and **Save**.

### 4.2 Providers: Google only

1. **Authentication** → **Sign In / Providers**.
2. **Email**: turn **off** (admins sign in with Google only).
3. Make sure **Allow new users to sign up** stays on (the hook above does the allow-listing).
4. **Google**: you'll come back here in step 5.4 to paste the client ID and secret.

### 4.3 URL configuration

1. **Authentication** → **URL Configuration**.
2. **Site URL**: `https://dispatch-bro-app.netlify.app`
3. **Redirect URLs**: add both:
   - `https://dispatch-bro-app.netlify.app/auth/callback`
   - `http://localhost:5173/auth/callback`
4. **Save**.

### 4.4 Recommended: session limits

Authentication → **Sessions**: if your plan offers it, set an **inactivity timeout** (e.g. 8h) and/or **time-box**. The console already stores sessions in `sessionStorage`, so closing the browser signs the admin out.

## 5. Google Cloud OAuth client

1. Go to console.cloud.google.com → project picker → **New project** (e.g. `dispatch-buddy-auth`) → **Create** → select it.
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

## 12. Print and share

1. Admin → **Backup & flyer** → paste the portal link → **Print flyer** (or "Save as PDF").
2. Post flyers in the shop and the break room; share the link where crews already talk.
