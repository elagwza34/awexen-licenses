# API on Hostinger

The public frontend and API share `https://licenses.awexen.com`.
The API base URL is `https://licenses.awexen.com/api/v1`; frontend builds use
`VITE_API_BASE_URL=/api/v1`. The backend runs on the existing Hostinger Business plan.
Cloudflare Worker `licenses-api-proxy` routes `licenses.awexen.com/api/*` to
the Hostinger backend at `api.awexen.com`, which stays available for old clients.
The proxy source is `infra/cloudflare/api-proxy.mjs`. It streams requests and
responses, preserves authentication and cookies, and disables API caching.
Its compatibility date is 2026-11-05, with logs and traces enabled.
The desktop client uses `License.BaseAddress=https://licenses.awexen.com`
and `License.ApiVersion=v1` in its appsettings files. Restart after changing them.
The PostgreSQL database and signing key are the same as the former Fly deployment.

The frontend's `public/.htaccess` supplies the LiteSpeed SPA fallback. Include it
when deploying the frontend build so direct visits to `/login` and dashboard
routes load `index.html`. Missing assets deliberately remain HTTP 404.

## Deployment

- Source: `backend/`, excluding `.env*`, keys, storage, node_modules and dist.
- Node.js: 22; framework: Express (Nest uses the Express adapter).
- Build script: `build:hostinger` (installs build dependencies and generates Prisma).
- Entry file: `hostinger-start.cjs`, relative to the application root.
- Output directory: unset, so the runtime includes dependencies and the entry file.
- Deployment metadata: `.hostinger/api-site.json`.

The startup entry validates and writes the existing signing key supplied through
`LICENSE_PRIVATE_KEY_PEM_B64`, then loads `dist/main.js`. Never generate a new
signing key during deployment. Do not put secrets into the deployment source.
Hostinger holds the production environment variables. Updates replace the full
set: preserve every configured variable, and never submit masked placeholder values.

This migration ran no seed or schema migrations. Apply future database migrations
deliberately, after reviewing them. Local source was uploaded; Git auto-deployment
is not configured for the API.

## Verification

Check `/api/v1/health` for `status: ok`, `database: up`, and `signingKeyLoaded: true`.
The public verification key must match `/api/v1/public-key` from before migration.
Test login and an authenticated `/api/v1/auth/me` request. CORS must allow both
`https://licenses.awexen.com` and `https://pms.awexen.com`.

## DNS and rollback

Cloudflare DNS directs `api.awexen.com` to `72.60.93.159` (DNS only), with no AAAA
record pointing to Fly. Hostinger manages HTTPS. Mail DNS was not changed.
Previous API DNS records are saved in `.hostinger/api-dns-before-migration.json`.
The old Fly app was retained for rollback; no new Fly billing was enabled.
Its staged CORS change never became active because Fly required billing details.

Receipts were not present at `/app/storage/receipts` on the old Fly instance.
Future uploaded receipts live in the Hostinger application's `storage/receipts`;
back them up before replacing application files in a future deployment.
