# Aadi CRM authentication foundation

This repository contains the authentication and role-based access foundation for Aadi CRM, plus leads and projects.

**Quick setup?** See [SETUP.md](SETUP.md) (requirements, backend/frontend install, run).

**New to this project?** Longer college guide: [SETUP_FOR_COLLEGE.md](SETUP_FOR_COLLEGE.md) (Postgres install, DB design, seed logins, run steps).

**Cursor / AI setup?** Paste the master prompt from [prompt.md](prompt.md) after unzipping the folder.

## Applications

- `backend/` — FastAPI, PostgreSQL, SQLAlchemy, Alembic
- `frontend/` — React, TypeScript, Material UI, i18next

## Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL listening on `localhost:5432`

## Start the database

Create a database named `aadi_crm` on the local PostgreSQL server. Put the connection string in `backend/.env` as `DATABASE_URL`. The password is stored only in that file, which is gitignored. `@` in a password must be written as `%40` in the URL.

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.cli.create_admin --email admin@example.com --full-name "System Admin"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The admin command asks for the password without echoing it. Omit `--password` so the secret is not stored in shell history. The command creates only the first administrator. After that, role changes are made by an authenticated administrator.

API documentation is at `http://localhost:8000/api/docs`.

### Password reset mail in development

`EMAIL_BACKEND=file` writes reset messages to `backend/var/outbox/`. Those files contain reset links, are gitignored, and are not written to the application log. Open the latest file and use its link. Configure `SMTP_HOST` and set `EMAIL_BACKEND=smtp` when a real mailbox is available.

## Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

The app runs at `http://localhost:5173`. Open that host, not `127.0.0.1`, when `VITE_API_BASE_URL` uses `localhost`. Browsers treat those names as different sites, so the HttpOnly session cookies are not sent across them while `COOKIE_SAMESITE=lax`.

## Authentication

- Public registration always creates a `SALESPERSON` account. The server ignores any role sent by the client.
- Login sets an HttpOnly access cookie and a revocable HttpOnly refresh cookie. Tokens are not returned in JSON and are not stored in `localStorage`.
- Unsafe requests send `X-CSRF-Token`, matching the CSRF cookie from `GET /api/v1/auth/csrf`.
- Refresh tokens rotate. Reuse of a revoked refresh token revokes that user's sessions.
- Password reset tokens are random, stored only as a SHA-256 hash, expire, and cannot be reused. A successful reset increments the session version and revokes refresh tokens.
- Passwords are hashed with Argon2id.

Authorization is permission-based. `SUPER_ADMIN`, `BUSINESS_OWNER`, `MARKETING`, and `SALESPERSON` are database roles. Super Admins receive the initial permission set. Business owners, marketing users, and salespeople receive only `features.read` until lead and tenant permissions are added. A user cannot change their own role or status.

## Import leads (Excel)

Upload an `.xlsx` file on **Leads** → the app maps column headers to common lead fields and that project’s **Lead Fields**, then creates leads. Repeated call-summary / follow-up columns merge into **Follow-up notes** when that field exists. Rows with a mobile that already exists in the company are skipped.

### Before import

1. Login as **Business Owner** or **Salesperson** (salesperson must be assigned to the project on Team).
2. Open **Leads** → **Manage fields** (tune icon) → select the project (e.g. Paneerwala) → create fields that match your Excel headers (Product, Quantity, Payment, Call time, Follow-up notes, etc.).
3. Prepare Excel: first row = headers; every data row needs **Name** and **Phone**.

### Import steps

1. Open **Leads**.
2. Click the **upload (import)** icon next to **+**.
3. Choose the project → choose the `.xlsx` file → **Import**.
4. A short success message appears; new leads show in the list (newest first). Re-importing the same phones skips those rows.

## Salesperson feature status

| Area | Status |
|------|--------|
| Login as `SALESPERSON` | Done |
| See leads for assigned projects / own ownership | Done |
| Create, edit, delete leads (with `leads.*` permissions) | Done |
| Reminders / follow-ups on own leads | Done |
| Import Excel leads for assigned projects | Done |
| Use project Lead Fields on create/edit/import | Done (owner usually configures fields first) |
| Full PRD sales suite (deals module, WhatsApp log, export, team dashboards) | Not complete yet |

**Summary for demo:** Salesperson can work assigned projects, manage their leads, use reminders, and import Excel. Lead Fields must be set up on the project before a good import. Deals / full export from the older PRD are not done yet.

## Checks

Backend, from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check app tests
.\.venv\Scripts\python.exe -m mypy app
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Frontend, from `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

## Environment

Backend variables are documented in `backend/.env.example`. Frontend variables are `VITE_API_BASE_URL` and `VITE_DEFAULT_LANGUAGE`.

Do not commit `.env` files, passwords, JWT secrets, or database credentials.
