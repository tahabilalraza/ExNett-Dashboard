# Historical spreadsheet import

The real workbook was inspected locally before this implementation. It is not
included in this repository, demo seeds, automated fixtures, or public artifacts.
The full private-data-free inspection report remains in the onboarding workspace.

The actual headers, in order, are Full Name, Country, Current Company, Current
Position, Email, Phone Number, LinkedIn Profile, Project, Industry, Status,
Hourly Rate, Recruited By, Tags, Remarks. There is no Expert ID header. In XLSX
these start at column B. The worksheet's Excel table covers only a subset of
the records, so the parser must inspect the populated worksheet cells instead.
Future files may include an optional Expert Id column.
An explicitly supplied ID is preserved on new records and checked for uniqueness;
files without it receive generated IDs. Revised files with the same ID therefore
require a reviewed link/update to the original expert, even if contact details change.

One row does not necessarily mean one new expert. Repeated contacts can describe
one expert on several projects or an identity conflict. The application separates
expert profiles, project membership, and operational activity. Shared email or
LinkedIn evidence needs review; names alone never merge people automatically.

Phones include numeric cells and strings. Numeric cells are converted to digit
strings without inventing lost zeros or country prefixes. Multiple/embedded
emails, malformed URLs, placeholder values, formula cells, and ambiguous quotes
are flagged. Formula contents are never evaluated or fetched. The source rates
include amount-plus-currency text and multiple currencies. Blank rates are not
zero, and imported quotes are not revenue.

Project punctuation is preserved; a comma or pipe is not automatically a list
separator. Project names require reviewed resolution because no legacy project ID
or client identifier is present. Industry labels outside spreadsheet dropdown
options remain valid historical inputs for review. Recruiter names do not create
user accounts. Legacy status does not establish current availability, a dated
consultation, or a payment. Projectless rows do not create fictional assignments.

Import is available to administrators and managers through Experts → Import.
Upload CSV or XLSX, inspect and adjust column mapping, review validation and
duplicate candidates, choose explicit create/link/update/skip decisions, map
projects and legacy labels, and confirm the staged batch. Updates are limited to
selected fields and never clear existing values from incoming blank cells.
Linking additional projects does not require overwriting the expert profile.

Staging expires automatically after seven days. Keep uploads out of version
control. Protect backups and MongoDB access as carefully as the original workbook.
Reimport the same file through its recorded batch to retain confirmed identity
decisions. Edited files require another preview because spreadsheet row numbers
are not durable person identifiers. CSV exports neutralize spreadsheet formula
prefixes, including plus-prefixed phone values.

Test fixtures use synthetic names, example.test addresses, and generated workbooks.
No real historical source file is automatically imported by install or seed scripts.
