# Dashboard attention

Attention is operational and spans all billing periods of the active ledger.
Period summaries and charts remain explicitly scoped to the selected month.
The read endpoint uses the existing server-side ledger view permission (owner,
editor and viewer); it does not add any mutation or payment action.

## Rules

- Dates use `business_today()` in `SYSTEM_RUN_TIMEZONE`. A due date strictly before
  today is overdue; today is upcoming. Billing period age alone is not overdue.
- Paid/canceled obligations, inactive or archived categories and disabled
  integrations do not contribute to attention.
- Errors are always visible. Multiple reasons appear on one obligation row.
- Ready payments enter the upcoming horizon at **two business days**, other
  lifecycles at **three business days**, reusing daily-report policy constants
  and the ledger's business calendar, including public holidays. Due-today and
  intervening non-working days are included; distant future payments are omitted.
- Draft/collecting obligations and unknown required amount/date values need data
  review once overdue, within their preparation horizon, or in error. A missing
  due date enters attention on the fifth business day of its current period,
  and remains visible in subsequent periods. Future periods have that grace
  period too. Issue date is not a required payment field.
- Integration status reuses `integration_status`: error, timed-out and stale
  health need attention, with each integration's configured deadline and
  `stale_after_seconds`. There is no new age threshold; never-run/running alone
  are not failures. Stale supersedes an older failure according to existing health
  precedence. Successful recovery removes the alert.
- Integration problems are attached only via their real category relation, to
  the latest attention obligation with an error/incomplete reason, once per
  integration. The UI states the integration's health without claiming it caused
  the obligation's problem. Otherwise the integration gets its own row/link.
- Priority: overdue, obligation error, integration problem, incomplete data,
  upcoming. Ties sort by due date (unknown last), case-folded name, stable key.
- Initially eight rows; “Show more” appends another eight. The read endpoint
  supports offset/limit (maximum 50 per request) and reports the total. Ordering
  is deterministic for an unchanged snapshot; changes between requests may
  reorder items, as with other offset-paginated lists.

## Trustworthy presentation

Amounts retain their currency and certainty; rows never total currencies or
replace missing amounts with zero. Estimated/overridden/confirmed amounts and
known due dates retain their state labels. User-owned names are never translated.
Demo rows carry the existing synthetic-data notice. Review links target the
obligation's own ledger, period and category with an explicit unpaid filter;
existing detail, permission, filter chips and removal flows remain in charge.

Attention is one atomic read of both sources. If either query fails the endpoint
fails, and the client displays unavailable attention, never an all-clear. Failed
later pages retain earlier rows and an error message. Loading, no items in the
review horizon and unavailable are different states. An empty attention list
makes no claim about later scheduled payments or the entire ledger's health.
The next-payment card uses unpaid obligation dates, including unknown amounts;
missing schedule data is incomplete rather than an apparent absence of payments.
