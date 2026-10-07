# Reviewed legacy import

`POST /api/imports/preview` accepts one multipart `file` (CSV or XLSX, maximum
8 MB), and optional `mapping` JSON. Mapping keys are literal headers and values
are destination keys listed in `mappableFields`, or `ignore`. Unknown columns
require an explicit mapping; repeated headers must be corrected in the source.
The preview scans all populated worksheet rows rather than Excel table bounds.
It supports offset headers and optional Expert ID/Tags columns. Numeric phones
become strings, without invented prefixes. Formulas and their cached results are
never evaluated. Uploaded bytes stay in memory and are erased after parsing;
there is no uploaded-file download endpoint.

The authenticated preview contains normalized fields, warnings, blocking errors,
contact/name-based candidates, source duplicates, and existing field snapshots.
Candidates never merge automatically. `GET /api/imports/:id` restores a review.
An owner or administrator can read a batch; only managers and administrators can
use import routes. Global CSRF protection applies to all mutations.

`POST /api/imports/:id/resolve` with `{rowNumber, expertId}` captures a selected
existing expert and its current field/version snapshot. Its response is the full
updated preview with a new confirmation token. This supports deliberate lookup
selection when contact matching did not find the intended target.

## Confirmation

`POST /api/imports/:id/commit` requires `confirmed: true`, the latest
`previewToken`, and `decisions` with exactly one explicit decision for every row:

```json
{
  "confirmed": true,
  "previewToken": "token returned by preview",
  "decisions": [
    {"rowNumber": 2, "action": "create"},
    {"rowNumber": 3, "action": "link", "linkRowNumber": 2},
    {"rowNumber": 4, "action": "update", "expertId": "MongoDB object ID", "fields": ["currentCompany"]},
    {"rowNumber": 5, "action": "skip"}
  ],
  "projectMapping": {"Synthetic whole project label": {"create": true, "name": "Synthetic project"}},
  "industryMapping": {"Synthetic industry label": {"create": true}},
  "statusMapping": {"Synthetic legacy status": "Contacted"}
}
```

- `create` generates a public UUID-based expert ID. An unmatched supplied legacy
  ID remains provenance; a matching supplied ID requires selecting its target.
- `link` adds provenance and reviewed memberships while preserving the profile.
- `update` requires the explicit `fields` list. Allowed fields are `fullName`,
  `country`, `currentCompany`, `currentPosition`, `email`, `phoneNumber`,
  `linkedinProfile`, `tags`, `remarks`, `industry`, `recruitedBy`, and
  `legacyRecruiter`. Blank/placeholder incoming values never clear existing data.
- `skip` makes no domain writes. Rows with blocking errors must be skipped.
- `expertId` selects a MongoDB expert ID captured in the preview;
  `linkRowNumber` instead links to an earlier resolved source row.
- `projectId` selects an existing project per row, or `projectName` explicitly
  approves creation. Global `projectMapping` maps the complete legacy label to
  a MongoDB ID, `{projectId}`, `{create:true,name?}`, or `{skip:true}`. Commas and
  pipes do not split labels. An unmapped label remains a protected observation.
- `industryMapping` accepts an existing ID, `{industryId}`, `{create:true,name?}`,
  or `{skip:true}`. Updates apply it only when `fields` includes `industry`.
- `recruiterMapping` maps a historical label to an existing active user ID or
  `{userId}`. It never creates user accounts. Updates require `recruitedBy`.
- A row can apply `status` explicitly, or `assignmentFields:["status"]` plus a
  reviewed `statusMapping`. `assignmentFields:["rate"]` promotes a successfully
  parsed amount with an explicit ISO currency. These apply to new memberships;
  existing conflicting current assignment values require a separate review.
  Removed memberships are never silently restored. Imported status and rate
  remain historical observations rather than master availability/default rates.

The transaction rechecks authorization, target versions, references, and
configured statuses, then atomically saves all reviewed records and an audit
with counts only. MongoDB must run as a replica set. A validation/conflict failure
rolls back the entire bounded batch. A repeat confirmation with the same choices
returns the recorded result; a different confirmation for that batch returns 409.
Unchanged source fingerprints survive in protected expert provenance, so even
after staging deletion a reimport supplies the prior target and refuses duplicate
creation. Expert/project membership uniqueness independently prevents duplicates.

Preview staging expires after 7 days; committed review staging expires after
30 days. `DELETE /api/imports/:id` deletes staging immediately and retains
imported domain records and durable source links. Contact-rich legacy provenance
is part of the protected expert record and follows that record's retention.
Uploads, previews, and source values must never enter public fixtures, logs, or
demo seeds. All committed tests use synthetic contacts and titles.

Limits: 2,000 populated data rows, 100 populated columns, 4,000 characters per
cell, 3,000 archive entries, 40 MB actual expanded ZIP contents, 20 MB per ZIP
entry, and 10 MB normalized staging. Archive entries are streamed and measured
before ExcelJS runs, so declared size metadata alone cannot bypass these bounds.
Worksheet XML is also bounded to 20,000 physical rows and 200,000 cells before
parsing, including styled empty cells; normal formatting beyond data is retained
within those limits.
Matching is bounded to 20,000 active expert profiles and 20 candidate experts
per source row; larger databases need indexed matching rather than unbounded scans.

Run synthetic parser checks with `node --test server/src/import/*.test.js`.
