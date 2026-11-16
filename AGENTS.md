# Surprisal

A single-page writing editor (React, CodeMirror) on Cloudflare Workers, deployed
with Alchemy v2 (`alchemy.run.ts`). The model runs on Modal (`scorer.py`).

- `bun run check` typechecks; `bun run build` bundles `frontend/` into `dist/`.
- Pushing to `main` on GitHub deploys prod (`.github/workflows/deploy.yml`), so
  don't also deploy by hand after a push.
- `bun run deploy` deploys the `prod` stage to surprisal.ink. It needs
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SCORER_URL` and
  `SURPRISAL_DOMAIN`. Other stages (`bunx alchemy deploy --stage <name>`) are
  previews on workers.dev with their own signing key, which `scorer.py` must
  list before they can score.
- Static files in `public/` are served before the Worker. `public/_headers`
  holds the security headers.
- Writing lives in the browser's IndexedDB; the server keeps only the daily
  scorer allowance in D1.
