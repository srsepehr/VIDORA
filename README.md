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

## Build

```bash
npm run typecheck
npm run build
```

The deployable files are generated in `dist/`.
