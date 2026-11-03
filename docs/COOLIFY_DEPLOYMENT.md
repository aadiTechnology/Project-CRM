# Deploying Aadi CRM on Coolify

One public address (e.g. `https://crm.example.com`) served by three containers:
`web` (nginx + built React app, forwards `/api`), `api` (FastAPI; runs `alembic upgrade head` on start) and `postgres`.
Only `web` is public, so the browser uses one origin and no CORS/cookie cross-site issues arise.

## Steps
1. Push this repo to Git (private repos need a Coolify deploy key / GitHub App).
2. Coolify -> **New Resource** -> the repo -> build pack **Docker Compose** -> file `/docker-compose.coolify.yml`.
3. **Environment Variables:** `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `JWT_SECRET` (`openssl rand -hex 32`), `APP_BASE_URL` (public https address, no trailing slash). Other names: `.env.coolify.example`.
4. **Domain:** set on the **`web`** service, port **8080**. No domain on `api`/`postgres`.
5. Deploy, then check `https://<domain>/api/v1/health` -> `{"status":"ok"}`.
6. Create the first admin (Coolify -> `api` -> Terminal):
   ```bash
   python -m app.cli.create_admin --email you@company.com --full-name "Your Name"
   ```
7. Schedule backups of the `postgres` volume `crm_pgdata` in Coolify.

## Later
- **Real email:** set `EMAIL_BACKEND=smtp` and `SMTP_HOST/PORT/USER/PASSWORD/FROM`, redeploy. With `file`, emails (e.g. password resets) are written to `/app/var/outbox`.
- **Updates:** push to the watched branch or press Redeploy. Migrations run on start and only move forward.
- **Single worker:** keep `WEB_CONCURRENCY=1` (login rate limits are in-memory).
- Do not run `seed_demo` in production.
