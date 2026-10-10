# Scheduled report delivery recovery

Scheduled reports reuse the system-run lock. Invoke delivery only while holding
that lock; do not start a second recovery/send process alongside the scheduler.

The delivery UUID is permanent. Its Message-ID is
`<report-UUID@oblidog.local>` across attempts. Message-ID aids diagnosis; SMTP
and recipient mailboxes do not guarantee deduplication or exactly-once delivery.

| Persisted status | Meaning | Next scheduled execution |
| --- | --- | --- |
| SENT | SMTP acceptance and DB commit confirmed | Skip |
| FAILED | Rendering failed, or SMTP definitely refused the send | Retry |
| IN_PROGRESS | Attempt committed before SMTP call | Convert to UNCERTAIN; never resend |
| UNCERTAIN | Timeout/disconnect/unknown send error, or interrupted attempt | Block pending operator recovery |

SMTP connection refusal, DNS failure, explicit connection/authentication/HELO,
sender/recipient refusal and DATA rejection are definite failures. Other errors
during send are conservatively uncertain. Library-level disconnect retries are
disabled for scheduled reports. SENT means SMTP accepted the message, not that
it reached the inbox. A crash just before send can also leave uncertainty.

Attempt count and start/finish timestamps describe the latest send attempt.
Unfinished attempts retain a null finish timestamp. Each configured report scans
all its unresolved delivery keys before selecting recipients, including older
dates and users who have since disabled reports. Stale IN_PROGRESS records become
UNCERTAIN; existing error diagnostics are preserved. New reports for other keys
can still be sent, but unresolved history remains visible on every run.
The scheduler step fails if
any outcome is failed or uncertain; warning logs identify uncertain delivery
UUIDs. Errors store only exception class names, never server text or mail data.

After stopping the scheduler and confirming no system run is active, inspect:

```sql
SELECT id, report_type, status, attempt_count, attempt_started_at,
       attempt_finished_at, sent_at, error_message
FROM report_delivery
WHERE status IN ('IN_PROGRESS', 'UNCERTAIN');
```

Use the Message-ID to check your SMTP provider logs. If acceptance is confirmed,
resolve the specific UUID as SENT (set sent_at to the known acceptance time).
If non-delivery is confirmed, resolve it as FAILED. If evidence is unavailable,
leave it UNCERTAIN, or deliberately authorize a retry accepting duplicate risk.
Recovery updates must target one reviewed UUID, guarded by its current status:

```sql
UPDATE report_delivery SET status = 'FAILED', error_message = NULL
WHERE id = '<reviewed-uuid>' AND status IN ('IN_PROGRESS', 'UNCERTAIN');
```

Retry occurs when that report's same delivery key is next executed. A daily
report for a past date needs a system run with that original business date;
resolving it does not send immediately. Never bulk-reset uncertain records.

Migration treats legacy FAILED records as UNCERTAIN because the old state also
represented an unfinished send. Downgrade refuses unresolved uncertain attempts.
