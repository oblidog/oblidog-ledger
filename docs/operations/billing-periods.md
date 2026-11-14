# Supported billing periods

New billing periods must be between **1970-01 and 2199-12**, inclusive. The
fixed lower boundary matches the Unix epoch year and leaves room for imported
history; the upper boundary leaves ample room for planning without admitting
accidental remote-future years. Periods remain year/month values, not timestamps.

The policy applies to manual creation (including onboarding), ensure requests,
internal creation services and scheduled generation. The generator stops at
December 2199 rather than creating January 2200. Upcoming-payment previews
also stay within the supported range. Integration endpoints currently operate
on existing obligations; they do not create new billing periods.

Existing records are not changed or deleted. Response schemas, domain keys,
read filters and integration addressing retain years 1–9999 so historical data
can still be read and existing obligations can be edited or paid. Frontend
creation and period-selection controls offer the supported range; all-period
lists and direct detail links retain access to older records. This policy does
not impose the same limits on issue dates, due dates or recurrence anchors.
For example, a December 2199 bill can still be due in January 2200.

## Audit before deployment

Run this read-only query against each deployment before rollout, including demo.
No automatic cleanup or database constraint migration is required. Review any
returned records with the owner; corrections must be explicit, never a silent
change of billing period.

```sql
SELECT ledger_id, period_year, period_month, COUNT(*) AS obligations
FROM obligation
WHERE period_year < 1970 OR period_year > 2199
GROUP BY ledger_id, period_year, period_month
ORDER BY ledger_id, period_year, period_month;
```

The regression suite exercises existing rows outside the supported write range.
Production data is not available in the development test environment; a passing
test run is not a production audit.
