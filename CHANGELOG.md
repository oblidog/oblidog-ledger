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
