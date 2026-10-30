# Oblidog email design system

React Email owns presentation. Python owns data selection, calculations,
preferences, scheduling, SMTP and runtime Jinja rendering. No JavaScript service
or external rendering API is involved in delivery.

This workspace owns the daily digest, weekly overview and all four transactional
layouts (invitation, password reset, new account and test email). All use shared
React Email components and authored plain-text templates. The legacy MJML and
copied transactional HTML sources have been removed after checking their callers.

## Commands (repository root)

Use Bun 1.4.3 and the committed root lockfile:

```bash
bun install --frozen-lockfile
bun run email:dev                 # React Email at http://localhost:3001
bun run email:export              # generate HTML/Jinja + text in backend/app/email-templates/build
bun run email:check               # byte-for-byte freshness check, does not rewrite files
bun run --filter @oblidog/emails typecheck
uv run --locked python emails/scripts/render_previews.py
uv run --locked pytest -q tests/test_email_templates.py tests/test_daily_digest_rendering.py tests/test_email_localization.py tests/test_weekly_email_rendering.py tests/test_transactional_email_rendering.py
```

`email:dev` previews `foundation.tsx` with its synthetic normal data.
For the full matrix, open `emails/previews/*.html` after running the Python
command; matching `.txt` files contain the plain-text body. These snapshots use
the actual exported Jinja template and production renderer. Fixture files cover
empty, normal, long-name (including unbroken text), long-list, multi-ledger and
multi-currency cases. All names, amounts and links are synthetic.

## Dependency security overrides

The root manifest pins `fast-uri` to 3.1.9 (fixes the four URI advisories)
and `html-to-text` to 10.0.1. The latter removes the unpatched `deepmerge`
dependency (GHSA-gcqx-w48m-w2h4) for both React Email renderer versions,
including the preview CLI. Version 10.0.1 uses `deepmerge-ts` >=8.0.1;
10.0.0 has a separate vulnerable dependency and must not be used.

This overrides React Email's declared html-to-text 9 range. The upstream v10
API retains the conversion functions and options; CI tests both renderers'
HTML/plain-text output and custom selectors, and checks all exported templates
for byte-for-byte stability. Use the documented Bun runtime (Node consumers
of html-to-text 10 require Node >=20.19). Remove the html-to-text override
when all React Email dependency paths require the safe release themselves.

## Shared components

`components/design-system.tsx` provides `EmailLayout`, `EmailHeading`,
`EmailSection`, `EmailSummary`, `ObligationRow`, `EmailButton` and `EmailFooter`.
Use a single readable column, table-based React Email layout, system fonts,
inline styles and a narrow-screen padding enhancement. Essential information
and the brand are text: images, custom fonts, flex/grid and JavaScript are not
required. A 600px container also works without media queries; rounded corners
are decorative. Browser previews are useful layout checks, not a substitute
for eventual Outlook/Gmail device checks.

## React → Jinja → HTML/text

`emails/foundation.tsx` can render either real fixture props for the preview
server, or a trusted template skeleton for export. The same visual components
are used in both paths. `scripts/export.tsx` uses React Email's `render()` API
and `JinjaTokens` to preserve trusted Jinja expressions and control statements
through React's HTML escaping. Tokens are restored only **after** React renders.
User data never enters this build step or the token registry.

The committed `foundation.html` retains nested loops over ledgers, currency
groups and obligations, an empty-collection branch and an optional notice.
Python evaluates these at delivery time with the real context. Amount labels
and summaries are supplied by Python; the template does not sum currencies or
select obligations. For example:

```python
from app.email_rendering import render_email_template

context = {"report": report_data}  # shape documented by fixtures/types.ts
html = render_email_template(template_name="foundation.html", context=context)
text = render_email_template(template_name="foundation.txt", context=context)
# Pass both to the existing EmailData/send_email pipeline when migrating a report.
```

HTML templates use Jinja autoescaping, including quoted attributes. Do not use
`|safe`, compile context values as Jinja source, or pass user content to
`JinjaTokens.code()`/`expression()`. The loader reads only the packaged build
directory. Callers must supply trusted, validated HTTP(S) application links;
HTML escaping alone does not validate URL schemes. Plain-text templates have
autoescaping disabled and preserve literal text and URLs.

The text template is maintained explicitly in `foundation.txt.jinja`. Automatic
HTML-to-text conversion at build time cannot reliably preserve Jinja control
flow, so both artifacts have independent runtime tests.

## Artifacts and deployment

Commit source, fixture changes, the root `bun.lock`, and regenerated HTML/text
together. The `Email Templates` workflow checks freshness without rewriting
files, typechecks the workspace, runs database-free Python regressions, renders
all fixtures, checks wheel contents and uploads preview artifacts.

Backend Dockerfiles already copy the complete `backend/app` tree, including
committed HTML/text. Python wheels package the same assets; CI checks this.
Frontend Docker build stages copy the email workspace manifest so frozen
workspace installation can resolve the root lockfile. There is no email build
step or Node dependency in the backend image or Vercel Python runtime.

To inspect a real multipart message during later migrations, follow the Mailpit
instructions in `development.md`. Use disposable local test data for report
previews; these commands do not run the scheduler or touch a database.

## Daily digest

`emails/daily-digest.tsx` and `daily-digest.txt.jinja` generate the live
`daily_obligation_report.html` / `.txt` artifacts. The Python presentation
adapter `app/services/daily_digest_presentation.py` only formats the already
selected rows and their subtotals. Selection, recipient access, the previous-day
activity window, business calendars, the no-email condition and delivery keys
remain owned by the existing report service.

The stable section order is overdue, obligation errors, ready to pay, needs
preparation and missing due date. Currency subtotals cover the complete selected digest, including rows omitted
from a size-limited email; confirmed/overridden values are separate from estimated/unconfirmed
values. Missing amounts stay unknown, and unspecified currencies are never
added together. Activity and integration health retain their details, links,
last-success timestamps and all truncation notices.

The 12 `fixtures/daily/*.json` cases cover each section, activity-only and
integration-health-only messages, long names/lists, multiple ledgers/currencies,
unknown amounts/dates and actual zero values. The Python preview command writes
`previews/daily-*.html` and `.txt`. These snapshots and the React preview share
the production presentation shape; regression tests also exercise the adapter
and the actual report entry point without touching a database.

### HTML size budget

`daily_digest_rendering.py` checks the UTF-8 size after Jinja rendering against
a 90 KiB budget. A priority prefix is retained with logarithmically bounded
rendering probes: obligation sections first, then integration health, then
activity. Neither the source selection nor monetary subtotals are changed.

Shortened HTML and text both include a notice near the top, visible/selected
counts, a link to the user's ledgers, per-section omitted counts and the existing
health/activity truncation notices. Summary and currency labels explicitly cover
the entire selection. A base layout that cannot fit even without detail rows
fails rendering instead of sending oversized HTML.

Regression cases include the review's mixed 35/40/20 digest, 70 obligations,
large escaped Unicode fields, priority preservation and the real report entry
point. Small digests retain all their data without size-truncation notices.

## Localization

Daily digests, weekly monthly overviews, password recovery, invitations, new
account and test emails render EN/PL/DE subjects and HTML/text bodies. Each render
receives an explicit recipient language; null, unsupported values and recipients
without an account fall back to English. Inviter and browser preferences do not
select the recipient language. The cached Jinja environment has no mutable locale.

`backend/app/email-locales/{en,pl,de}.json` is shared by Python runtime rendering
and React Email previews. Use semantic keys, complete sentences and named
placeholders. Tests enforce matching keys and placeholders. English and German plurals use
one/other; Polish uses one/few/many/other, including 12 versus 22. Runtime
`EmailLocale` is immutable and passed into presentation and template rendering.

Amounts use Decimal throughout, retain sub-cent precision and at least two
fraction digits, and use a decimal point in English or comma in Polish and German. Dates
are ISO in English and DD.MM.YYYY in Polish and German; timestamps retain the report
timezone. Currency codes and grouping, selection, scheduling, delivery keys,
user content and external diagnostics keep their original meaning.

`email:export` and `email:check` cover all committed HTML/text artifacts. They
contain locale-neutral Jinja translation calls; the backend supplies the locale
without Node at runtime. The preview command additionally renders
`daily-{normal,empty,unknown,multi-currency,long-content}-{en,pl,de}`, the weekly matrix described below, and every transactional email in all supported languages.
The localized fixtures use the production presentation and size-budget renderer.
Tests cover interleaved recipients, multipart output, escaping, pluralization,
precision, omitted counts and the 90 KiB limit. Scheduled delivery regression
tests verify all supported languages in one run and retry deduplication.

## Weekly monthly overview

`emails/weekly-overview.tsx` and `weekly-overview.txt.jinja` export the live weekly
HTML/text artifacts using the same shell, typography, summaries and footer as
the daily digest. Python retains the existing calculations, recipient selection,
Monday cadence, reporting timezone, comparison eligibility and ISO-week delivery
key. The only new context value is a configured application link to the ledgers.

Each ledger has separate currency cards. Known total, paid and remaining amounts
are prominent; incomplete totals keep a visible notice. All status counts,
unknown/unconfirmed counts, overdue count/known amount, previous-month total and
eligible change remain available. The percentage is explicitly **by obligation
count**, never monetary progress. The original selection and row order are
preserved; large messages show a bounded prefix as described below. No totals
across currencies or new ratios are calculated.

`fixtures/weekly/*.json` contains decimal strings and ISO dates, shared with the
React preview. `scripts/weekly_fixtures.py` converts them to Decimal/date inputs
and renders through production Jinja. The preview command writes both EN/PL
HTML and text for normal, empty, no-ledger, unknown, zero, previous-month-only,
unavailable-comparison, multi-ledger/currency and long-content cases. Long
synthetic names and 40 upcoming payments are retained without horizontal overflow
at 320/390 px. Layout uses email-compatible presentation tables with two compact
amount columns and single-column payment rows. Browser checks supplement, but
do not replace, mailbox-client testing.

### Weekly HTML size budget

`weekly_overview_rendering.py` enforces a 90 KiB UTF-8 budget after Jinja renders.
Summary blocks (each currency card or empty ledger) take priority over upcoming
payment rows. If all summaries fit, the renderer retains the largest fitting
prefix of payment rows; otherwise it retains a prefix of summary blocks without
payment rows. Calculated values in retained blocks and the input objects are
never modified.

Every shortened candidate includes EN/PL counts of visible/selected summary
blocks and upcoming payments, plus a full-data link near the top. Each retained
currency also states its own shown/selected payment count when shortened; zero
visible rows are not labeled as an empty source list. HTML and text use the same
selection and notices. An impossible base layout raises rather than sending
oversized HTML. Tests cover the 6-ledger/4-currency regression, large escaped
payment lists, giant Unicode names, input immutability and serialized MIME size.

## Transactional messages

`components/transactional.tsx` shares the report shell, typography, action button
and footer. Four small files in `emails/` expose each design in the React Email
preview server. `scripts/export.tsx` fixes the message kind at build time and
exports each existing artifact name; recipient data stays escaped Jinja context.
The corresponding `emails/{reset_password,user_invitation,new_account,test_email}.txt.jinja`
files provide explicit plain-text alternatives. Every action has a visible URL
fallback. Recipient locale, token URLs, expiry and authentication behavior remain
owned by existing Python generators and callers.

`fixtures/transactional/*.json` covers normal, long content, escaped values and
missing optional names in EN/PL. The Python preview command writes
`previews/{template}-{case}-{language}.{html,txt}`. Rendering uses no images,
external fonts or JavaScript. Regression tests inspect decoded multipart bodies
and exact action/fallback URLs, including encoded token characters. Captured-mail
invitation/password-reset flows remain covered by isolated Playwright/Mailpit CI.

New-account generation currently has no active application caller. Its public
generator and artifact names are retained and migrated for compatibility; this
change does not activate a new account-email flow. All four MJML sources and the
editor-specific MJML export instructions are retired. Backend wheel/Docker
packaging continues to use the same build directory and all HTML/text assets.
