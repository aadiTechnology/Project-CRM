# Aadi CRM — project setup

This guide covers what you need installed, how to set up the **backend** and **frontend**, demo logins, and how **Excel lead import** works.

For a longer college-oriented walkthrough (DB diagram, table list), see [SETUP_FOR_COLLEGE.md](SETUP_FOR_COLLEGE.md). Feature notes live in [README.md](README.md).

---

## 1. What you need

| Tool | Version | Why |
|------|---------|-----|
| **PostgreSQL** | 16+ | Stores companies, users, projects, leads |
| **Python** | 3.12+ | FastAPI backend |
| **Node.js** | 22+ | React (Vite) frontend |
| **Git** | any recent | Clone the repo |

During PostgreSQL install:

- Remember the password for user `postgres`
- Keep port **5432**
- Optional: install pgAdmin to browse tables

**Important:** Use the **same host** in the browser and API base URL. Recommended: **`127.0.0.1`** for both (frontend + `VITE_API_BASE_URL`). Mixing `localhost` and `127.0.0.1` breaks login cookies / CSRF.

---

## 2. Create the database

Open **SQL Shell (psql)** or pgAdmin Query Tool:

```sql
CREATE DATABASE aadi_crm;
```

Tables are created later by Alembic migrations — you only create the empty database once.

---

## 3. Backend setup

Open PowerShell in the project root, then:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

### 3.1 Configure `backend/.env`

Edit at least:

```env
DATABASE_URL=postgresql+psycopg://postgres:CHANGE_ME@localhost:5432/aadi_crm
JWT_SECRET=college-demo-secret-at-least-32-characters-long
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
FRONTEND_BASE_URL=http://127.0.0.1:5173
```

- Replace `CHANGE_ME` with your Postgres password  
- If the password contains `@`, write it as `%40` in the URL  
- Keep `JWT_SECRET` long and private (do not commit `.env`)

### 3.2 What gets installed (backend packages)

Install is driven by `backend/pyproject.toml`. Main packages:

| Package | Role |
|---------|------|
| FastAPI + Uvicorn | HTTP API server |
| SQLAlchemy + Alembic | ORM + DB migrations |
| psycopg | PostgreSQL driver |
| Pydantic / pydantic-settings | Request validation + settings |
| PyJWT + argon2-cffi | Auth tokens + password hashing |
| openpyxl | Excel (`.xlsx`) lead import |
| python-multipart | File upload form data for import |
| pytest / ruff / mypy (dev) | Tests and lint |

### 3.3 Migrate, seed, run

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.cli.seed_demo
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Leave this terminal open.

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:8000 | API |
| http://127.0.0.1:8000/api/docs | Swagger docs |

`alembic upgrade head` creates tables and demo companies/projects/leads.  
`seed_demo` resets the Super Admin password and prints demo login emails.

---

## 4. Frontend setup

Open a **second** PowerShell window:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

### 4.1 Configure `frontend/.env`

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_DEFAULT_LANGUAGE=en
```

### 4.2 What gets installed (frontend packages)

Install is driven by `frontend/package.json`. Main stack:

| Package | Role |
|---------|------|
| React + React Router | UI + routing |
| TypeScript | Typed frontend |
| Vite | Dev server + build |
| Material UI (MUI) | Components / layout |
| i18next | Language support |

### 4.3 Start the app

```powershell
npm run dev
```

Open: **http://127.0.0.1:5173**

---

## 5. Demo logins

After `seed_demo`:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@example.com` | `CollegeDemo#1` |
| Business Owner (Aadi) | `arjun@aadi-demo.test` | `AadiDemo#2026` |
| Salesperson | `riya@aadi-demo.test` | `AadiDemo#2026` |
| Salesperson | `kunal@aadi-demo.test` | `AadiDemo#2026` |

Sign in as **Arjun** (owner) or **Riya** (salesperson) to see projects and leads.

### Salesperson — what works today

- Login as salesperson  
- See leads for **assigned projects** / own ownership  
- Create / edit / delete leads (with permissions)  
- Reminders / follow-ups  
- **Import Excel** for projects they are assigned to  

Owner usually configures **Lead Fields** first. Full PRD items like a separate deals module / WhatsApp log / full export are **not** complete yet.

---

## 6. Import leads (Excel)

### Before import

1. Login (owner or salesperson assigned to the project).  
2. Open **Leads** → **Manage fields** (tune icon) → select project (e.g. **Paneerwala**).  
3. Add / check fields that match your Excel headers (Product, Quantity, Payment, Call time, Follow-up notes, etc.).  
4. Prepare an `.xlsx` file:
   - Row 1 = column headers  
   - Every data row needs **Name** and **Phone**  
   - First sheet is used  

### Import steps

1. Open **Leads**.  
2. Click the **upload (import)** icon (next to **+**).  
3. Choose the project → choose the `.xlsx` file → **Import**.  
4. Success message appears briefly; new leads show in the list (newest first).  
5. Re-importing the **same mobile numbers** → those rows are **skipped** (duplicates).

How mapping works:

- Headers like Name, Phone, City, Amount, Priority, Status map to normal lead fields  
- Other headers map to that project’s **Lead Fields** by label/key  
- Repeated Call Summary / Follow-up columns merge into **Follow-up notes** when that field exists  

---

## 7. Common problems

| Problem | Fix |
|---------|-----|
| Login / CSRF fails | Use `127.0.0.1` for both Vite and `VITE_API_BASE_URL`; restart both servers |
| `password authentication failed` | Wrong password in `DATABASE_URL` in `backend/.env` |
| `python-multipart` / form upload error | `.\.venv\Scripts\python.exe -m pip install -e ".[dev]"` again |
| No leads after login | Run `alembic upgrade head` then `seed_demo` again |
| Import icon disabled (salesperson) | Assign them to the project on **Team** |
| Import skips every row | Mobiles already exist — expected duplicate behaviour |

---

## 8. Quick checklist

- [ ] PostgreSQL running, database `aadi_crm` created  
- [ ] Backend venv + `pip install -e ".[dev]"`  
- [ ] `backend/.env` filled (`DATABASE_URL`, `JWT_SECRET`)  
- [ ] `alembic upgrade head` + `seed_demo`  
- [ ] Backend on http://127.0.0.1:8000  
- [ ] Frontend `npm install` + `.env` pointing at API  
- [ ] Frontend on http://127.0.0.1:5173  
- [ ] Can login with a demo account  
- [ ] (Optional) Manage fields on Leads → Excel import  

Do **not** commit `.env` files, passwords, or Excel sample dumps unless your team explicitly wants them in git.
