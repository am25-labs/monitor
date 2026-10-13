# JSON exports

Settings → Export provides a full database backup or an export of one, several,
or all projects. Exports preserve the stored IDs and foreign keys. Project and
monitor IDs are UUIDs generated with `crypto.randomUUID()`.

The full backup includes every application table, SQLite sequences, and the SQL
definitions of the application tables, indexes, and triggers. Project exports
include their groups, monitors, jobs, retained history and aggregates, technical
and public incidents, incident updates and monitor associations, notifications
and deliveries, status pages, and applicable maintenance windows. Global
maintenance windows are included because they apply to the selected projects.
Global settings, engine state, and SQLite sequences are exclusive to full backups.
Selecting all projects is therefore distinct from selecting a full backup.

The JSON contains `format`, `formatVersion`, `appVersion`, `startedAt`, `scope`,
`consistency`, `credentials`, `schema`, `data`, and `completedAt`. Each key under
`data` is a table name containing its unmodified database rows. JSON columns
remain stored strings; encrypted columns remain encrypted strings. No credentials
are replaced with the redacted values from the dashboard snapshot.

Keep the installation's original `CONFIG_KEY` separately. It is required to
decrypt monitor configuration, notification credentials, and delivery receipt
tokens. Deployment secrets, Cloudflare infrastructure, queued messages, and
Durable Object state are outside the database and are not included in this file.
This feature exports data; it does not add a restore/import operation.

Downloads use the authenticated admin API and are never cached. The Worker reads
and streams rows in batches without applying the dashboard's history limits.
Per-table row ID bounds prevent newly appended records from extending the export
indefinitely. Reads occur over the download period, so concurrent edits or
deletions can affect later reads. This is a live export, not an atomic snapshot.
Runtime limits still apply to very large downloads; interrupted streams must not
be treated as completed backups. A completed file ends with `completedAt` and
must parse as valid JSON.

## Contract and example

The machine-readable [JSON Schema](data-export.schema.json) describes export
format version 1, including all fields in the 19 full-backup tables and the 16
project-export tables. Validate `format` and `formatVersion` before consuming a
file; the `schema` field inside an export contains SQLite SQL definitions, not
the JSON Schema.

The [complete project example](data-export.example.json) contains fictional data
for September 2026 in UTC: one project, one HTTP monitor, 30 daily aggregates,
and one resolved incident. It produces 99.98% observed availability and a 245 ms
average successful-check latency. Its encrypted `config` is an illustrative
placeholder, not decryptable credentials. `results` is empty intentionally;
monthly metrics can be computed from the retained daily aggregates alone.

## Monthly report consumers

An external application can keep its own client-to-project UUID mapping.
Monitor does not store client IDs, mailing lists, report templates, or email
schedules. Each selected project is found in `data.projects` by `id`. Find its
monitors by matching `data.monitors[].project_id`, then find their daily metrics
by matching `data.daily_stats[].monitor_id`.

For a UTC calendar month, filter `day` using the half-open range from the first
day of the requested month to the first day of the next month. Daily, hourly,
and five-minute bucket strings all use UTC. Numeric timestamps such as
`opened_at`, `closed_at`, and `checked_at` are Unix seconds; multiply by 1000
when constructing a JavaScript `Date`. Root `startedAt` and `completedAt` are
ISO 8601 strings. A report based on a different timezone cannot use UTC daily
aggregates as exact local calendar days; define that reporting policy explicitly.

Calculate metrics for the selected records as follows:

```text
observedSeconds = sum(observed_seconds)
availableSeconds = sum(up_seconds)
outageSeconds = observedSeconds - availableSeconds
availabilityPercent = 100 * availableSeconds / observedSeconds
averageLatencyMs = sum(latency_sum) / sum(latency_count)
```

Return an unavailable metric when its denominator is zero. Do not average
per-day or per-monitor percentages or latency averages without weighting them.
Availability measures observed time, not guaranteed coverage of the entire
month. Maintenance and missing observations can reduce the observed period.
Combining multiple monitors with these formulas gives weighted monitor-time
availability; it does not establish the availability of a composite service.
Keep per-monitor metrics when the intended service-level meaning is unclear.
Latency aggregates count successful checks with non-null latency measurements.
`monitors.last_latency` represents the latest check, not a monthly average.

For a daily availability strip, follow Monitor's state rules: no observed seconds
means no data; `up_seconds < observed_seconds` means an interruption; otherwise,
`degraded_count > 0` means degradation; otherwise the day is available.
`degraded_count` is a bucket counter, not an incident count or duration in seconds.

For reportable incident summaries use `public_incidents`, their associated
`incident_updates`, and `incident_monitors`. Match the selected project UUIDs
through `public_incidents.project_id`. When reporting only published incidents,
require `published === 1`. Include incidents whose interval overlaps the month:

```text
opened_at < monthEnd && (closed_at === null || closed_at > monthStart)
```

Count unique incident IDs, including incidents that started before the month and
remained open during it. Count incidents opened during the month separately if
that is the desired statistic. Do not count an automatic public incident and its
technical `incidents` record twice: `public_incidents.technical_id` links them.
For a multi-monitor incident, `incident_monitors.incident_id` points to the public
incident ID, and `monitor_id` points to each affected monitor. Updates provide the
stage, message in each language, and event time. Blank messages may occur for
automatic updates. Incident duration and observed outage seconds are different
metrics and should not be substituted for each other.

The export contains all retained history, not a pre-filtered reporting month.
Detailed results are retained for six calendar months; daily aggregates and
resolved incidents are retained for 365 days. An external reporting application
must filter the requested period and store past exports or reports when needed.
It does not need to decrypt credentials, inspect jobs, or read notification
delivery tokens to calculate these monthly metrics.
