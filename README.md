# Vidora Website

Production-ready static website built from the Vidora Design System landing page.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill the Supabase values in `.env.local` before testing real login/signup.
Backend setup details are in `docs/backend-setup.md`.

### Development dashboard preview

To review the dashboard without authentication or database access, add this
development-only flag to your untracked `.env.local`:

```bash
VIDORA_ENABLE_DASHBOARD_PREVIEW=true
```

Run `npm run dev`, then open
`http://127.0.0.1:5173/dev/dashboard-preview`. The route returns HTTP 404 unless
the flag is exactly `true` and the app is running in development mode with
`NODE_ENV=development`.

## Build

```bash
npm run typecheck
npm run build
```

The deployable files are generated in `dist/`.

## Internal admin operations

The protected Persian admin area lives at `#/admin`. It requires an active
server-side admin membership and never relies on route hiding for authorization.
Architecture, permissions, migration, bootstrap, deployment, and limitations are
documented in [`docs/admin-operations.md`](docs/admin-operations.md).
