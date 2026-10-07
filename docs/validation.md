# Validation evidence

The application was installed and exercised in the cloud workspace using Node.js
24, the committed npm lockfile, a real MongoDB 8.0.32 single-node replica set, and
headless Chromium. All fixtures and browser mutations use synthetic records.
The historical workbook was inspected locally for structure only and was not
loaded into the demo database, committed, or published.

Verified checks:

| Check | Outcome |
| --- | --- |
| Clean npm ci from the lockfile | Passed |
| Repeated local setup, Mongo startup and synthetic seed | Passed; existing records/passwords preserved |
| Node automated tests | 22 passed, 0 failed, 0 skipped |
| Production Vite build | Passed with lazy page chunks |
| Chromium desktop/mobile workflow | Passed; no script, console, network or API server errors |
| Production server smoke | Passed: Mongo connection, build assets, SPA deep routes, CSP and unauthorized API rejection |
| Production dependency npm audit | 0 vulnerabilities reported at verification time |
| Historical-data/source-control privacy checks | Source workbook, contact values and private files excluded |

Six parser tests cover offset headers/partial Excel tables, string-preserving CSV,
numeric phones, quoted newlines, identity collisions, header mapping conflicts,
currency handling, safe LinkedIn host recognition and oversized normalized fields.
Sixteen API integration tests use an isolated randomly named database. They cover
initial administrator bootstrap and password truncation protection, cookie authentication/CSRF/logout, unauthorized requests, expert CRUD and unique
IDs, combined filtering/search/sort/pagination, injection-shaped query rejection,
client/project relationships and dates, one expert on several projects, removed
membership reuse, activity references/commercial calculations, actual-count and
currency reconciliation, role enforcement and session revocation, soft archives,
CSV formula protection, private import previews, explicit decisions, blank-field
preservation, project mapping, retained supplied Expert IDs across revised files,
idempotent reimports and stale-preview protection.

The financial regressions also verify that an unrelated activity edit preserves
an explicitly entered expert cost, and a cost-only currency does not report an
invented zero revenue or margin.

Browser smoke verifies protected routing, invalid/valid sign-in, logout, every
navigation module, expert creation/search/detail, project creation and expert
assignment, activity creation, reviewed CSV import, and a 390px mobile viewport
without document overflow. It confirms each write through the API, archives only
the synthetic records created by that run, and saves local ignored screenshots.
The form-control accessible labels and local favicon were corrected after the
initial browser run. External font requests were removed; typography uses system
fallbacks and charts display without entrance animation.

Commands:

```bash
npm run db:start
npm test
npm run build
npm run test:production
npm run dev
# In a second terminal:
npm run test:browser
```

Scope and remaining limits:

- Import supports one populated visible XLSX worksheet per upload; split multi-sheet
  workbooks into separate files. Uploads are bounded to 8 MB, 2,000 populated rows,
  100 columns and 40 MB expanded archive size. Matching currently scans at most
  20,000 active experts. Larger installations need indexed import-candidate matching.
- Lookup endpoints/selectors cap results at 2,000. Expert list search/filtering and
  pagination remain server-side. Selector search can narrow expert/project results;
  installations beyond these bounds should add consistently paginated selectors.
- Monetary reporting uses validated finite JavaScript numbers rounded to two
  decimals, separated by currency. It is operational reporting, not an accounting
  ledger or audited payment system. No FX conversion or invented revenue occurs.
- Long-term private legacy observations remain on imported experts; preview/batch
  staging has expiry. Secure database access and a business retention policy are
  required for real imports and backups.
- Real historical import execution, deployment to a public host, production HTTPS
  proxy configuration, managed MongoDB credentials, email delivery and payment
  integrations were not performed. Production smoke checks local server behavior;
  it does not claim a deployed service or publication snapshot was validated.
- Docker volumes hold local database state separately from the workspace snapshot.
  Recreate synthetic development data or use a managed database/secure backups in
  future machines; no fresh-task database restoration is claimed.

README describes secure administrator bootstrap and production configuration.
Further phases include email/calendar/LinkedIn integration, payments, richer CRM,
documents, configurable permissions, advanced matching and forecasting.
