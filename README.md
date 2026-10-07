# ExNett Internal Operations Dashboard

JavaScript MERN application for expert profiles, projects, clients, multi-project
assignments, dated activity, team permissions, reviewed spreadsheet imports, and
operational reporting. Business data lives in MongoDB and all mutations go through
authenticated Express APIs.

## Run locally

Requirements: Node.js 22+ (24 recommended), npm, and Docker for the included MongoDB
helper. An existing MongoDB replica set or Atlas database can replace Docker.

```bash
cd ExNett-Dashboard
npm ci
npm run setup:local
npm run db:start
npm run seed
npm run dev
```

Frontend port: 5173. API port: 4000. Vite proxies /api to Express. MongoDB 8.0.32 runs
as a local replica set on loopback port 27017; Docker volume `exnett-mongo-data`
holds its data. Setup preserves an existing server/.env. Seed preserves records,
passwords, and organization settings and never imports the historical workbook.

The optional seed requires a non-production `exnett_demo` database and
`SEED_DEMO=true`. Its fictional records are visibly marked as demo data.

| Demo role | Email | Password |
| --- | --- | --- |
| Administrator | admin@exnett.test | ExNettDemo!2026 |
| Manager | manager@exnett.test | ExNettDemo!2026 |
| Team Member | member@exnett.test | ExNettDemo!2026 |

Do not use these public demo credentials with private production records.

## Configuration

`npm run setup:local` creates an ignored server/.env with a random session secret.
Otherwise copy server/.env.example and supply your settings securely.

| Variable | Purpose |
| --- | --- |
| MONGODB_URI | Replica-set/Atlas connection; required in production |
| SESSION_SECRET | Unique random secret, at least 32 characters in production |
| NODE_ENV | development or production; production enables Secure cookies/static frontend |
| PORT / HOST | Backend port/interface, defaults 4000 / 0.0.0.0 |
| CLIENT_ORIGIN | Exact allowed browser origin; defaults to localhost port 5173 |
| TRUST_PROXY | 1 only behind one trusted HTTPS reverse proxy; otherwise 0 |
| SEED_DEMO | Explicit local synthetic-seed opt-in |
| ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME | One-time initial-admin bootstrap inputs |

Do not commit connection credentials, passwords, session secrets, or uploads.

## Using the application

Dashboard shows database-derived counts, classification breakdowns, activity,
and currency-separated rates/commercial summaries. Experts supports profile CRUD,
search, combined filters, sorting, pagination, CSV export, assignments and history.
Projects and clients have CRUD/detail views and relationships. Assigning the same
expert to several projects creates memberships without duplicating the expert.
Activities records real dated outreach, interviews, notes and consultations, with
optional commercial inputs. Reports provides pipeline, classification, recruiter,
project, utilization, turnaround and currency-separated financial reporting.

Team administration manages users, roles, activation and password resets. Settings
supports profile/password, organization, taxonomy and configurable statuses.
Members have ordinary operational read/write access; managers can additionally
archive, import and manage settings/taxonomy; administrators also manage accounts.
Backend authorization enforces these permissions independently of button visibility.

Profiles, projects, clients and activity use archive rules to preserve history.
Sessions use MongoDB-backed HttpOnly cookies, CSRF tokens and server-side revocation.
No authentication token is stored in browser localStorage.

## CSV/XLSX migration

Open Experts → Import as a manager or administrator. Upload, inspect/map headers,
review field warnings and duplicate candidates, choose create/link/update/skip,
resolve project/status/taxonomy mappings, and confirm the staged batch. Only chosen
nonblank fields update an existing profile; contact collisions never silently merge.

The real workbook lacks Expert ID, includes Tags, contains an incomplete Excel
table, mixes numeric/text phone cells, uses currency-bearing rate strings, and
repeats identity evidence across projects. These patterns drive the importer.
Formula cells are not executed, project punctuation is preserved, and historical
status does not create consultation dates or revenue. Details:
[legacy-import.md](docs/legacy-import.md).

Previews are restricted to their owner or an administrator. Staging has bounded
retention and can be deleted without deleting imported records. Keep private
uploads/backups outside source control, public deployments and demo fixtures.
CSV export neutralizes spreadsheet formula prefixes.

## Verify and build

```bash
npm run db:start
npm test
npm run build
npm run test:production
npm run dev
# In another terminal, against the running development servers:
npm run test:browser
```

API tests use a separate randomly named exnett_test database and drop only that
database. Import fixtures are synthetic. Browser checks require Chromium; set
CHROMIUM_PATH if it is not installed at /usr/bin/chromium. See
[validation.md](docs/validation.md) for verified outcomes and limitations.

## Production and deployment

```bash
npm ci
npm run build
# Supply production variables securely and initialize the first administrator:
npm run admin:create
npm start
```

Supply NODE_ENV=production, a private replica-set MONGODB_URI, a strong unique
SESSION_SECRET, the exact public CLIENT_ORIGIN and appropriate TRUST_PROXY.
Initial bootstrap additionally requires ADMIN_EMAIL, ADMIN_PASSWORD (at least 12
characters and at most 72 UTF-8 bytes), and optional ADMIN_NAME. Remove bootstrap variables afterward. The
command refuses to replace an existing active administrator. Never seed demo
accounts into a private production database.

Express serves the frontend build and API on one origin. Separate frontend hosting
must reverse-proxy /api to the backend because the current client uses relative
API URLs. Use HTTPS; do not deploy the Vite development server. Production needs
database authentication, restricted access, backups, monitoring and recovery checks.

Docker volumes are separate from the cloud workspace snapshot. Do not assume local
database contents survive new tasks/publication. Recreate synthetic records with
seed as needed; use a managed database or secure backups for real records.

## Structure and later phases

```text
client/src/    React pages, components, contexts, API services and hooks
server/src/    Express auth/config, Mongoose models, routes, services and imports
server/test/   Integration tests
scripts/      Local setup, MongoDB helper and browser smoke checks
docs/         Architecture, import rules and validation evidence
```

See [architecture.md](docs/architecture.md) for data/security decisions. This MVP
provides operational reporting, not an accounting ledger. Email/LinkedIn/calendar
integrations, payments, richer CRM, document attachments, configurable permissions,
advanced matching and forecasting are later phases.
