# Architecture and data correctness

React renders API-backed pages; Express owns authorization, validation and writes;
Mongoose persists all operational entities in MongoDB. npm workspaces keep the
frontend and backend separated while sharing a single reproducible lockfile.

Experts are master profiles. Assignments connect experts to projects through a
unique expert/project membership. Activities record real dated events separately
from membership, and reference the associated expert/project/assignment. Removed
assignments and archived experts/projects/clients retain historical references.
No archive action deletes the underlying historical records.

Sessions reside in MongoDB and use HttpOnly cookies, SameSite=Lax, and Secure in
production. Login rotates the session and CSRF token. Mutating requests require
the token from /api/auth/csrf. Passwords use bcrypt. A session version invalidates
sessions after password/role changes. Every authenticated request verifies the
user is still active. Roles are enforced in the backend: members have operational
read/write access; managers can archive, import, and manage taxonomy/settings;
administrators also manage team accounts. Password hashes are excluded from API
serialization, and server errors omit private database content.

Expert lists use server pagination, sorting, composable filters, and debounced
browser search. User inputs become validated scalar query parameters, never
arbitrary MongoDB operators. Text search uses escaped literals. Indexes cover
identifiers, contact candidates, classification, relationship keys, and dates.
This is suitable for an initial internal database; very large installations should
measure query plans and consider dedicated MongoDB search indexes.

Commercial values originate only from entered consultation billing, rates,
duration, and currency. Missing inputs remain missing. Aggregations keep currencies
separate, and revenue never derives from a historical status or an expert's rate
alone. This provides operational reporting rather than an accounting ledger.

Import batches provide authenticated staged review, raw-value preservation with
expiry, explicit identity/field decisions, transaction-backed application, and
retry protection. The local database runs as a replica set to support transactions;
an external MongoDB replica set or Atlas deployment can replace it.

Deployment requires HTTPS, a private database, secure session configuration,
backups, and a separately bootstrapped administrator. Local demo users are synthetic
and must not be used in production. The application does not send email, contact
LinkedIn, process payments, or automatically recruit experts.
