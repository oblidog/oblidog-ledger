## Unreleased

### BREAKING CHANGE

- Removed the legacy workbook importer, including the ledger `GET`/`POST
  `/api/v1/ledgers/{ledger_id}/legacy-import` endpoints, the `legacy_import`
  System Run task, and the dedicated adapter/Dropbox dependencies.
- Remove `DROPBOX_API_KEY`, `LEGACY_IMPORT_MODE`, `LEGACY_IMPORT_LEDGER_ID`,
  `LEGACY_IMPORT_CONFIG_PATH`, and any importer YAML bind mounts from deployment
  configuration. They are no longer used. No Dropbox credentials are required.
- The database upgrade drops only `legacy_import_job` and its job history.
  Imported obligations, categories, payment history, persisted `legacy` source
  values, and historical System Runs remain available. Downgrading recreates
  the empty job table; it cannot restore discarded import job history.
- The project remains on 0.x (`major_version_zero = true`); this breaking
  removal requires a minor release.

## v0.21.4 (2026-11-01)

### Fix

- **version**: identify Vercel builds in the footer (#603)
- **obligations**: restore active category and status badges (#596)

### Refactor

- **demo**: simplify login messaging and entry action (#602)
- **ui**: unify ledger page headings and tools (#597)
- **obligations**: simplify filters and emphasize unpaid items (#595)
- **analytics**: compare costs across recorded periods (#594)

## v0.21.3 (2026-10-30)

### Fix

- **deps**: remove vulnerable deepmerge and update fast-uri (#583)

## v0.21.2 (2026-10-29)

### Fix

- **deps**: bump filelock from 3.25.2 to 4.2.1 (#580)

## v0.21.1 (2026-10-22)

### Fix

- **deps**: resolve reported Bun and Python security alerts (#558)

## v0.21.0 (2026-10-22)

### Feat

- **i18n**: add German UI and email localization (#540)

## v0.20.3 (2026-10-21)

### Fix

- **deps**: update vulnerable Python dependencies (#543)

## v0.20.2 (2026-10-17)

### Refactor

- **demo**: expose read-only feature previews and compact demo indicator (#537)
- **frontend**: split category and obligation workspaces (#534)

## v0.20.1 (2026-10-16)

### Fix

- **deps**: bump virtualenv from 21.2.0 to 21.7.13 (#525)

## v0.20.0 (2026-10-16)

### Feat

- **reports**: redesign weekly overview with React Email (#519)
- **i18n**: localize scheduled reports and transactional emails (#518)
- **i18n**: stable API error codes and localized client errors (#517)
- **i18n**: translate the application interface into Polish (#516)
- **i18n**: add EN/PL foundation and user language preferences (#515)

### Refactor

- **email**: migrate transactional emails to React Email (#520)

## v0.19.0 (2026-10-15)

### Feat

- **reports**: redesign the daily digest with React Email (#507)
- **email**: add React Email design system and safe Jinja export (#506)

### Fix

- **notifications**: handle uncertain scheduled report delivery outcomes (#499)

### Refactor

- **categories**: consolidate category data record queries (#498)
- persist and display integration run history with retention (#495)

## v0.18.1 (2026-10-09)

### Fix

- **config**: require explicitly configured SECRET_KEY (#475) (#488)
- **frontend**: align toast theme and opaque desktop header (#474) (#487)

## v0.18.0 (2026-10-08)

### Feat

- **notifications**: add independent user report toggles (#482)
- **ledgers**: configure holiday calendars and default currency (#468)

### Fix

- **frontend**: scope obligation spinner to the active tile (#467)
- **categories**: share holiday-aware schedule preview with obligation generation (#466)

### Refactor

- **frontend**: streamline mobile obligation actions (#465)
- **categories**: show and apply counterparties to current obligations (#464)

## v0.17.1 (2026-10-06)

### Fix

- **obligations**: allow draft confirmation and confirm payment actions (#457)
- **deps**: bump emails (#454)

## v0.17.0 (2026-09-27)

### Feat

- **demo**: cap shared data and add read-only fallback (#273) (#446)
- **demo**: protect manual reset and configure daily Vercel Cron (#278) (#440)
- **demo**: prepare FastAPI Preview for Neon (#431)

### Fix

- **demo**: use direct Neon URL for hosted reset (#445)
- **auth**: allow Swagger token login with browser session (#443)
- **backend**: show Oblidog version and favicon in API docs (#439)
- **frontend**: hide Analytics from mobile bottom navigation (#438)

### Refactor

- **frontend**: improve obligation details dialog with tabs (#447)

## v0.16.1 (2026-09-22)

### Fix

- **demo**: hide TanStack devtools in screenshots (#428)

## v0.16.0 (2026-09-22)

### Feat

- **demo**: enrich canonical seed dataset (#411)
- **ops**: add standalone Docker Compose deployment (#409)

### Fix

- **auth**: strengthen password reset token fingerprints (#424)
- **demo**: keep overdue obligations representative (#420)
- clean up repository type and format checks
- **demo**: show all obligations and use EUR (#416)
- **ops**: harden standalone deployment installer (#410)
- hide floating-point noise in category data deltas (#408)
- **ops**: add database-aware readiness checks (#407)
- **auth**: make password reset tokens single-use (#406)
- **auth**: move browser authentication to HttpOnly cookies (#405)
- **auth**: invalidate sessions after password changes (#404)

### Refactor

- **demo**: add local counterparty logos (#415)
- **analytics**: focus page on component history (#412)
- **analytics**: add selectable component history matching (#403)

## v0.15.0 (2026-09-19)

### Feat

- **notifications**: report unhealthy integrations (#397)
- **notifications**: summarize meaningful daily activity (#394)

## v0.14.0 (2026-09-18)

### Feat

- **api**: return component upsert mutation result (#385)
- **frontend**: add obligation action history (#369)
- **frontend**: show active filters as removable badges (#366)

### Fix

- ignore decimal scale in action log diffs (#389)
- **frontend**: move integration data access to integrations (#388)
- **frontend**: move integration data to a dedicated page (#365)
- **categories**: make CSV export compatible with Excel (#364)

## v0.13.0 (2026-09-13)

### Feat

- **analytics**: compare obligation components across periods (#357)
- **components**: present obligation components in a table (#356)
- **category-data**: export history to CSV (#355)
- **frontend**: display application version (#354)
- **categories**: show category data differences (#353)
- **frontend**: add user invitation management and activation (#352)
- **auth**: replace direct user creation with invitation flow (#351)
- **obligations**: add append-only action log (#349)
- **frontend**: simplify integration details layout (#348)

## v0.12.4 (2026-09-12)

### Fix

- **integrations**: type integration context response (#343)
- **frontend**: render category date-times in local timezone (#342)

### Refactor

- **api**: address integration obligations by period (#344)

## v0.12.3 (2026-09-11)

### Fix

- **integrations**: derive record sources from context (#338)

## v0.12.2 (2026-09-11)

### Refactor

- simplify integration model (#333)

## v0.12.1 (2026-09-11)

### Fix

- **analytics**: show payment progress by amount (#329)
- **analytics**: use theme color for period totals (#328)
- **frontend**: humanize category date-time values (#327)

## v0.12.0 (2026-09-10)

### Feat

- **frontend**: add Counterparty catalog management (#304)

### Fix

- **deps**: move shared options to Playwright update group (#322)

## v0.11.0 (2026-09-09)

### Feat

- **frontend**: expose obligation counterparty assignments
- **frontend**: expose category counterparty assignments
- **frontend**: add obligation counterparty assignments
- **frontend**: add category counterparty assignments
- **frontend**: add counterparty autocomplete
- **frontend**: add counterparty logo
- **frontend**: add counterparty API helpers
- **counterparties**: include counterparty in obligation responses
- **counterparties**: expose counterparty on obligations
- **counterparties**: export assignment schema
- **counterparties**: add category and obligation assignments
- **counterparties**: add assignment schema
- **counterparties**: inherit category counterparty on obligation creation
- **counterparties**: register counterparty routes
- **counterparties**: export counterparty schemas
- **counterparties**: implement counterparty API
- **counterparties**: implement counterparty service
- **counterparties**: expose category counterparty
- **counterparties**: define counterparty schemas
- **counterparties**: add counterparty migration
- **counterparties**: link obligations to counterparty
- **counterparties**: link categories to default counterparty
- **counterparties**: export counterparty model
- **counterparties**: add global counterparty model

### Fix

- **frontend**: avoid duplicate obligation labels in counterparty panel
- **frontend**: avoid duplicate category labels in counterparty panel
- **frontend**: correct counterparty test API URL
- **frontend**: normalize obligation counterparty callback
- **frontend**: normalize counterparty mutation callback
- align counterparty model with case-insensitive uniqueness
- enforce case-insensitive counterparty names
- handle partial counterparty updates and name conflicts
- preserve omitted counterparty fields on patch
- make counterparty patch partial

### Refactor

- **frontend**: make Counterparty selection contextual (#296)
- **counterparties**: assign category counterparty explicitly

## v0.10.0 (2026-09-09)

### Feat

- add Counterparty UX (#292)

## v0.9.0 (2026-09-09)

### Feat

- **integrations**: add monitoring and owner configuration UI (#283)
- add integration registry and health reporting (#282)

## v0.8.0 (2026-09-07)

### Feat

- **demo**: add demo credentials and UI (#265)
- **demo**: add backend security restrictions (#263)
- **demo**: add reusable relative-date demo seed (#261)
- **notifications**: add weekly monthly overview report (#254)
- **categories**: render schema-driven data history table (#244)
- **categories**: filter data records by schema version (#241)
- **categories**: expose category data schema version history (#238)

### Refactor

- **categories**: move custom data history to dedicated page (#243)

## v0.7.9 (2026-09-07)

### Fix

- **obligations**: confirm issue date when marking ready (#264)

## v0.7.8 (2026-09-06)

### Fix

- code scanning alert no. 1: Workflow does not contain permissions (#253)

## v0.7.7 (2026-09-06)

### Refactor

- **analytics**: add category cost donut (#235)

## v0.7.6 (2026-09-06)

### Fix

- **analytics**: make charts readable on mobile (#231)
- **deps**: clean up dependency lockfiles (#228)

## v0.7.5 (2026-09-05)

### Fix

- **analytics**: contain payment schedule chart on mobile (#225)

## v0.7.4 (2026-09-05)

### Fix

- potential fix for code scanning alert no. 24: use of a broken or weak cryptographic hashing algorithm on sensitive data (#221)

## v0.7.3 (2026-09-05)

### Fix

- potential fix for code scanning alert no. 23: Insecure randomness (#220)

## v0.7.2 (2026-09-05)

### Refactor

- **branding**: update backend and OpenAPI identity (#214)

## v0.7.1 (2026-09-03)

### Fix

- 189-mark-error-lifecycle-semantics (#192)
- **notifications**: use business calendar for daily reports (#191)

### Refactor

- **obligations**: estimate missing amounts from history (#194)

## v0.7.0 (2026-09-02)

### Feat

- **categories**: add minimal JSON editing for data schemas (#179)

## v0.6.2 (2026-09-02)

### Fix

- **categories**: move data schema builder to a dedicated page (#173)

## v0.6.1 (2026-09-01)

### Fix

- **system-run**: show step execution details (#168)
- **ci**: pin uv version in playwright workflow

## v0.6.0 (2026-08-31)

### Feat

- **reports**: send daily obligation digest (#160)
- **notifications**: track scheduled report deliveries (#158)
- **system-run**: add manual execution history UI (#154)
- **system-run**: add production scheduler runner (#153)
- **system-run**: add orchestration core (#150)

### Fix

- **system-run**: deploy production scheduler (#156)
- **analytics**: contain category history chart on mobile (#152)

## v0.5.0 (2026-08-29)

### Feat

- **analytics**: add ledger dashboard (#135)
- **analytics**: add period totals endpoint (#134)

### Fix

- validate integration OpenAPI client generation (#143)

## v0.4.0 (2026-08-28)

### Feat

- **analytics**: add remaining period cashflow (#129)
- **analytics**: add category amount history (#128)
- add responsive authenticated navigation (#124)
- manage obligation components (#123)
- add obligation components (#121)

### Fix

- **tests**: use secure randomness for passwords

## v0.3.0 (2026-08-25)

### Feat

- **categories**: add category management table (#108)
- show category data record history
- expose category data schema metadata (#103)
- use category codes in integrations (#101)
- add category custom fields builder (#98)
- add schema-validated category data (#94)

### Refactor

- store category data records (#105)

## v0.2.1 (2026-08-23)

### Fix

- **ci**: upload canonical OpenAPI asset name

## v0.2.0 (2026-08-23)

### Feat

- **categories**: improve obligation schedule UX (#77)
- **categories**: simplify obligation recurrence configuration (#75)

## v0.1.0 (2026-08-22)

### Feat

- add obligation integration endpoints (#55)
- add ledger-scoped integration API keys (#50)
- **release**: automate version bumps on main (#52)

### Fix

- **ci**: allow explicit release image dispatch
- **ci**: finalize releases after release PR merge
- **ci**: prepare releases through pull requests
- **ci**: stabilize release version detection

## v0.0.1a4 (2026-08-21)

### Fix

- **ci**: publish container images under the repository owner

## v0.0.1a3 (2026-08-21)

### Feat

- **system-run**: add obligation ensure controls
- **system-run**: add legacy import controls
- **legacy-import**: add asynchronous workbook migration

### Fix

- **backend**: resolve email typing errors
- migrate TanStack Table to v9

## v0.0.1a2 (2026-08-19)

### Feat

- **obligations**: complete ledger obligation workflow

## v0.0.1a1 (2026-08-16)

### Feat

- **deploy**: add production runtime configuration
- **deploy**: add production runtime configuration
- **deploy**: add production runtime configuration

## v0.0.1a0 (2026-08-16)

### Feat

- **ledger**: enforce immutable category codes
- **categories**: require codes and currencies
- **categories**: add recurrence configuration
- **ledgers**: add ledger settings management
- **frontend**: manage ledger member access
- **backend**: manage ledger member access
- **frontend**: share ledgers by email
- **backend**: share ledgers by email
- **frontend**: add ledger settings workspace
- **frontend**: add archived data visibility toggle
- **categories**: enforce four-letter category codes
- **categories**: add category editing
- **frontend**: add category group editing
- **categories**: add category group editing
- **domain**: move obligation configuration to categories
- **frontend**: add ledgers and categories UI
- add ledger and category management APIs
- **backend**: add obligations ledger domain foundation
- initial commit
- initial commit

### Fix

- improve logo asset accessibility
- **categories**: prevent editing immutable codes
- **categories**: remove deletion confirmation hint

### Refactor

- **frontend**: simplify ledger workspace header
- **backend**: migrate auth and users to sqlalchemy and pydantic
- clean up github workflows
- clean up template auth and demo domain
- clean up template auth and demo domain
