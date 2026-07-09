# Vidora Backend Setup

## Repository Audit

- Framework: Vite 6 + React 18 single-page app.
- Routing: hash routes in `src/main.jsx`.
- Public routes: `/`, `#/library`, `#/library/category/:slug`, `#/watch/:slug`, `#/login`, `#/signup`.
- Private routes: `#/dashboard`, `#/dashboard/new-translation`, `#/dashboard/videos`, `#/dashboard/saved`, `#/dashboard/subscription`, `#/dashboard/support`, `#/dashboard/settings`.
- API routes: none. This repository is frontend-only.
- Auth before this phase: mock localStorage login through `vidora-viewer`.
- Auth after this phase: Supabase Auth email/password through a typed browser adapter.
- Existing video processing backend: not present.
- Existing payment backend: not present.
- Existing library content: local curated mock data for public discovery only.
- Existing user data: now read from Supabase tables through authenticated RLS.
- Existing language state: localStorage preference only, not authentication.
- Build system: GitHub Pages workflow runs `npm ci` and `npm run build`.

## Environment Variables

Copy `.env.example` to `.env.local` and fill the public Supabase values.

```bash
cp .env.example .env.local
```

Required for the frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

Server-only variables, not used in browser code:

- `SUPABASE_SERVICE_ROLE_KEY`
- Worker and provider credentials for later processing phases.

Never expose `SUPABASE_SERVICE_ROLE_KEY` or AI provider keys in Vite variables.

## Supabase Setup

1. Create a Supabase project.
2. In Supabase Auth, enable Email/Password sign-in.
3. For this phase, disable mandatory email confirmation if you need immediate dashboard redirect after signup.
4. Apply the database migration:

```bash
supabase db push
```

or paste `supabase/migrations/202607080001_initial_schema.sql` into the Supabase SQL editor.

5. Confirm these storage buckets exist:

- `vidora-video-uploads`
- `vidora-video-results`

6. Add your Supabase URL and anon key to `.env.local`.
7. Restart the dev server.

## What Works In This Phase

- Real account creation through Supabase Auth.
- Real login through Supabase Auth.
- Real logout through Supabase Auth.
- Session restoration after refresh in the same browser tab through Supabase token refresh.
- Dashboard route protection.
- Safe internal `returnTo` redirects.
- Profile synchronization on login/signup.
- User videos are read from `videos` under RLS.
- Active subscription summary is read from `subscriptions` under RLS.
- Public library browsing remains discoverable for guests.
- Premium watch attempts are gated after opening a video.
- Central Persian error messages with English developer logs.

## What Is Intentionally Not Complete Yet

- Uploading video files to Storage.
- Creating processing jobs from the upload form.
- Downloading/transcribing/translating/rendering videos.
- Payment provider integration.
- Subscription activation from payment webhooks.
- Google OAuth.
- Password reset email flow.
- Server-side media URL signing for premium library videos.
- HttpOnly cookie sessions. This static Vite app can use Supabase browser tokens, but truly secure cookie sessions require a server/edge layer.

Those require a server or worker layer with service-role access. This frontend never exposes service-role credentials.

## Validation Commands

```bash
npm run typecheck
npm run build
```

If local build fails because `node_modules/@tailwindcss/vite` is incomplete, run:

```bash
npm install
```

Then retry `npm run build`.

## Next Phase

Build the server/worker layer:

1. Create signed upload URLs.
2. Insert `videos` and `video_jobs` records server-side.
3. Download supported public URLs server-side.
4. Extract audio.
5. Transcribe with timestamps.
6. Translate transcript to Persian only.
7. Generate subtitle files.
8. Store outputs in private storage.
9. Return signed playback/subtitle URLs only after auth and subscription checks.
