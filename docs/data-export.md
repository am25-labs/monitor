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

Project exports offer one month, a full year, or all retained history. Month and
year boundaries are UTC calendar boundaries, independent of the instance's
display timezone. The month defaults to the current UTC month. Full backups
always include all retained data.

The admin API accepts `scope=projects&project=<uuid>&period=month&year=2026&month=9`
or `period=year&year=2026`, with repeated `project` parameters for multiple projects.
Omit `period`, `year`, and `month` for all history (the existing API behavior).
Years range from 1970 through 9998; months range from 1 through 12.

Filtered exports add optional `scope.period` metadata without changing version 1:

```json
{
  "type": "projects",
  "projectIds": ["504c69e2-f9d1-45a6-b520-be898bf90631"],
  "period": {
    "type": "month",
    "year": 2026,
    "month": 9,
    "timeZone": "UTC",
    "start": "2026-09-01T00:00:00.000Z",
    "end": "2026-10-01T00:00:00.000Z"
  }
}
```

Annual periods use `type: "year"`, omit `month`, and end on January 1 of the
following year. `start` is inclusive and `end` exclusive. Results use
`checked_at`, jobs use `due_at`, and aggregate buckets use `day`, `hour`, or
`slot`. Incidents and maintenance are included when their intervals overlap the
period, even if they began earlier or end later. Original timestamps are not
clipped; consumers must clip durations to the report interval when calculating
time inside the period. Technical incidents referenced by overlapping public
incidents are also retained to preserve that relationship.

Incident monitor associations follow the included public incidents. Updates and
notifications are restricted to creation times inside the period and to included
incidents; delivery rows follow included notifications. Earlier/later updates are
omitted. Projects, groups, monitor configurations, and status pages remain their
current stored records, including current monitor status and incident stage;
this is not a reconstruction of configuration or state at the period's end.
All project and monitor UUIDs remain unchanged.

The JSON contains `format`, `formatVersion`, `appVersion`, `startedAt`, `scope`,
`consistency`, `credentials`, `schema`, `data`, and `completedAt`. Each key under
`data` is a table name containing its unmodified database rows. JSON columns
remain stored strings; encrypted columns remain encrypted strings. No credentials
are replaced with the redacted values from the dashboard snapshot.

Keep the installation's original `CONFIG_KEY` separately. It is required to
decrypt monitor configuration, notification credentials, and delivery receipt
tokens. Deployment secrets, Cloudflare infrastructure, queued messages, and
Durable Object state are outside the database and are not included in this file.
Settings → Export also supports restoring these files. Restoration requires the
installation's existing `CONFIG_KEY`; it neither changes that key nor reciphers
the imported values.

## Restoring a backup

Only full backups and project exports with all history can be restored. Files
with `scope.period` are reports and are rejected before replacement, since
restoring partial history would discard the remaining project data.

Select a JSON file of up to 20 MB. Monitor validates the format, version, table
columns, relationships, configurations, and encrypted values before replacement.
An incompatible or differently encrypted file is rejected before any data is
changed. The file's SQL definitions are never executed.

The confirmation dialog states the replacement scope. A full backup replaces
all application data and settings. A project backup replaces only the projects
listed in its scope and their related data. Other projects, global settings, and
global maintenance windows are preserved. Global maintenance entries included
in a project export are ignored during its restoration.

Deletion and insertion run in one database batch transaction. Constraint failures
roll back the entire replacement. Project IDs, monitor IDs, and retained history
are preserved. Pending/running check jobs and pending/sending notifications are
cancelled, and notification leases are cleared to avoid replaying old work.
Monitors become due for new checks after 60 seconds; their paused state remains
unchanged. Existing queue messages whose jobs are absent or cancelled cannot
reapply old checks. Restoration requires admin authentication, a valid request
origin, and an explicit `RESTORE_BACKUP` confirmation.

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

Select a month or year to download a pre-filtered report, or all history for a
restorable project backup. Use `scope.period` to identify a report's interval.
Detailed results are retained for six calendar months; daily aggregates and
resolved incidents are retained for 365 days. Selecting an older period can
therefore return partial or empty history; it does not recover expired records.
External reporting applications should store past exports or reports when needed.
It does not need to decrypt credentials, inspect jobs, or read notification
delivery tokens to calculate these monthly metrics.
