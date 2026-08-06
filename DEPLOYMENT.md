# IMPI Deployment — Setup Guide

Everything here is free tier (Supabase free project + GitHub Pages) — no subscription.

## 1. Create the Supabase project

1. Go to supabase.com → New Project. Name it `impi-deployment`.
2. Once created, go to **SQL Editor** → New Query.
3. Open `supabase/schema.sql` from this project, paste the entire contents in, and click **Run**. This creates all 5 tables, security policies, and a starter rate card (edit the rates afterward in the app under Officer Roster → Rate Card).
4. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public key** — you'll need both in step 3 below.
5. Go to **Authentication → Providers** and make sure **Email** is enabled (it is by default). This gives you magic-link sign-in like your other IMPI apps.
6. (Optional but recommended) Go to **Authentication → URL Configuration** and add your live site URL (from step 4 below) once you have it, so magic links redirect correctly.

## 2. Create the GitHub repo

1. Go to github.com → New repository → name it exactly `impi-deployment` → **Public** (GitHub Pages free tier requires public) → Create.
2. Open the repo, press `.` on your keyboard to launch github.dev (the visual file editor — this handles the nested folder structure properly, unlike the plain web editor).
3. Drag every file and folder from this project into github.dev (keep the folder structure exactly as-is: `.github/workflows/deploy.yml`, `public/`, `src/`, `supabase/`, plus the root files like `package.json`, `vite.config.js`, `index.html`).
4. Commit directly to `main`.

## 3. Add your Supabase keys as GitHub secrets

1. In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
2. Add secret `VITE_SUPABASE_URL` = your Project URL from step 1.4.
3. Add secret `VITE_SUPABASE_ANON_KEY` = your anon public key from step 1.4.

## 4. Turn on GitHub Pages

1. **Settings → Pages → Build and deployment → Source** → select **GitHub Actions**.
2. Go to the **Actions** tab — the Deploy workflow should already be running (it triggers on every push to `main`). Wait for the green check.
3. Your app is now live at: `https://shaneimpi.github.io/impi-deployment/` (or whichever GitHub username owns the repo).

## 5. Add your logo

The header expects a file at `public/logo.png`. Drop your IMPI logo PNG into the `public` folder (name it exactly `logo.png`), commit, and it'll appear in the header on every page automatically. Recommended: roughly 200x60px, transparent background.

## 6. Sign in

Go to the live URL, enter your `@impi-secure.co.za` email, check your inbox for the magic link, click it — you're in.

## Day-to-day use

1. **Dashboard → + New Event** → upload the quotation `.xlsx` (the one with Setup + Builder tabs) → confirm → Posting Sheet is generated automatically.
2. Any Officer Type your quote used that isn't in the rate card yet gets flagged — go to **Officer Roster → Rate Card** and fill in its real PSIRA Grade and Pay Rate.
3. Assign officers on the Posting Sheet (pick from your saved roster, or type manually — either way it's saved to the roster for next time).
4. Print or copy the share link to send to your supplier.
5. On the day, use Check In / Check Out per officer.
6. Open **Pay Run** for that event any time — it's always in sync with the Posting Sheet, calculated live, with a CSV export button.

## Known Phase 2 items (not yet built)

- Public read-only share link for suppliers who don't have an IMPI login (currently the share link requires signing in with an `@impi-secure.co.za` email)
- Offline queue for check-in when there's no signal on site (same approach as your Job Cards PWA)
- On-screen signature capture
