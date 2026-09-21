<p align="center">
  <a href="https://oblidog.com">
    <img src="frontend/public/assets/images/oblidog-logo.svg" alt="Oblidog" width="280">
  </a>
</p>

<h2 align="center">Keep your payments on a leash.</h2>

<p align="center">
  A self-hosted home for recurring bills and household obligations.<br>
  Know what is due, automate what you can, and keep the history.
</p>

Oblidog is not another budgeting dashboard. It is an operational view of the
bills you actually need to handle—from the moment they arrive until they are
paid.

## Why Oblidog?

Bills rarely live in one place. Amounts arrive in provider portals, due dates
land in emails, payments happen elsewhere, and a spreadsheet remembers only
what someone took the time to type into it.

Oblidog gives that work one clear workflow:

- **Know what needs attention.** See upcoming, overdue, collecting-data,
  ready-to-pay, and paid obligations across billing periods.
- **Automate the repetitive parts.** Integrations can bring in amounts,
  charge breakdowns, readings, provider data, and payment status.
- **See what changed.** Keep each period's values and compare amounts,
  components, and structured data instead of overwriting last month's row.
- **Keep control of the data.** Run Oblidog on your own infrastructure and
  decide which external jobs can update each category.

## From bill to history

**Organize → Track → Automate → Pay → Compare**

Create a category for a recurring bill and Oblidog creates its obligations for
each billing period. Fill them in manually, connect an integration, or combine
both approaches. Oblidog keeps the current state visible while preserving the
details of previous periods.

For example, a housing bill appears for September. An integration supplies the
amount, its individual charge components, and the latest readings. Once the
data is complete, the obligation becomes ready to pay. When payment is
recognized, it is marked paid—but September's breakdown stays available for
comparison with October.

Oblidog tracks the workflow; it does not initiate bank payments.

## Automation without lock-in

Oblidog is useful with manual entries, but integrations are where the routine
work starts to disappear.

Each integration is connected to one category with its own scoped connection
key. An external job can:

- update the obligation for a billing period;
- add or update its charge components;
- store category-specific data such as invoices, consumption, or readings;
- move the obligation through its lifecycle, including recognizing payment;
- report its latest run and health back to Oblidog.

Provider-specific jobs run separately from the Ledger application, so you can
use the integrations maintained by the Oblidog project or build a small adapter
for your own provider. Oblidog does not claim to be a universal bill collector.

The built-in System Run handles Oblidog's own scheduled work: creating
obligations, estimating missing amounts, and sending reports when email is
configured. It does not launch external provider integrations.

See the [integration API guide](docs/integration-api.md) and its
[OpenAPI specification](openapi/integration.json) for the current contract.

## What you can do

- Review obligations by period and lifecycle state.
- Track totals, due dates, notes, and detailed bill components.
- Compare recurring components and structured provider data over time.
- Inspect the action history to understand what changed and when.
- Share a ledger using owner, editor, and viewer roles.
- Monitor the latest status of configured integrations.
- Run the application with Docker Compose and included or external PostgreSQL.

## The model in one minute

A **ledger** is a shared workspace. **Categories** describe recurring types of
bills, such as electricity, housing, or mobile service. Each category produces
an **obligation** for a billing period. An obligation moves from incomplete data
to ready, paid, canceled, or error while retaining its amount, components,
structured data, and history.

For precise rules, see [obligation states and actions](docs/obligation-lifecycle.md),
[structured category data](docs/category-data-records.md), and
[obligation action history](docs/obligation-action-log.md).

## Quick start: self-host

The standalone installer sets up Docker Compose with PostgreSQL and persistent
database storage. Docker Engine with the Compose plugin is the only
prerequisite; a source checkout is not required.

```bash
mkdir oblidog-ledger
cd oblidog-ledger
curl -fsSL https://raw.githubusercontent.com/oblidog/oblidog-ledger/main/scripts/install.sh | bash
```

Edit `.env`: replace the placeholder secrets, choose a published immutable
`TAG`, and review the public URLs and bind addresses. Then validate the
configuration and start the stack:

```bash
./validate-deployment.sh standalone
docker compose pull
docker compose up -d
docker compose ps
```

With the template defaults, open `http://localhost:8080`. The `prestart`
service applies database migrations before the application starts, and the
database has no published host port.

An external PostgreSQL and reverse proxy variant remains available for existing
setups. Read the [self-hosting guide](docs/self-hosting.md) for both variants,
proxy configuration, scheduler settings, upgrades, and the
[database backup and recovery runbook](docs/operations/database-recovery.md)
before deploying.

## Project status

Oblidog is open-source software in active early development. The core bill
workflow, shared ledgers, historical views, System Run automation, and
integration API are available. The interface and integration setup will
continue to evolve, and provider-specific integrations remain separate jobs.

## Documentation

- [Self-hosting and operations](docs/self-hosting.md)
- [Integration API guide](docs/integration-api.md) · [OpenAPI specification](openapi/integration.json)
- [Obligation states and actions](docs/obligation-lifecycle.md)
- [Structured category data](docs/category-data-records.md)
- [Obligation action history](docs/obligation-action-log.md)
- [Development setup](development.md) · [Backend](backend/README.md) · [Frontend](frontend/README.md)

Oblidog is developed in public by the
[Oblidog GitHub organisation](https://github.com/oblidog) and released under
the [MIT license](LICENSE).
