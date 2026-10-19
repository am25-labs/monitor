# Dashboard metrics

The overview displays daily availability and average successful-check latency
for the last 30 UTC calendar days, including the current partial day. The button
below the charts opens `/app/metrics`. This route is absent from both the sidebar
and mobile navigation options.

The detailed view supports 7, 30, or 90 days, custom date ranges and project/group/monitor filters. It shows
weighted availability, weighted latency, observed outage duration, incidents
started in the period, incident opening/recovery trends, and monitor/day tables.
Its data comes from the authenticated `GET /api/v1/admin/metrics` endpoint with
`days` or inclusive UTC `start`/`end`, plus optional `project`, `group` and `monitor` query parameters.

Availability is `100 * sum(up_seconds) / sum(observed_seconds)`. Latency is
`sum(latency_sum) / sum(latency_count)`, counting only successful checks with
non-null measurements. Missing observations produce null values and gaps in the
charts. Observed outage is the difference between observed and available seconds;
across monitors it represents summed monitor-time, not wall-clock downtime for
one composite service. The current day is incomplete.

Incident trends count technical incidents once, excluding their duplicate public
representations. The per-monitor table counts incidents whose intervals overlap
the period, including those opened earlier and still active. The started counter
counts only incidents opened inside the period. Data refreshes every 30 seconds;
the dashboard refresh button also refreshes the detailed metrics.

Custom date ranges cover up to 366 UTC days per query. Project, group and monitor
filters intersect. JSON exports include the selected daily dataset, units and
interpretation limits; they are analysis reports, not restorable backups.
See [Analytics API and MCP](analytics.md) for programmatic queries and retention.
