# Analytics API and MCP

Monitor exposes the same daily measurement calculations used by Metrics through
an authenticated read-only REST API and a stateless MCP server. No endpoint can
change monitors, incidents, maintenance or notifications. Administrative routes
continue using Cloudflare Access.

## Data retention

| Data | Automatic retention |
| --- | --- |
| Individual checks | Six calendar months |
| Five-minute availability buckets | 48 hours |
| Hourly aggregates | 90 days |
| Daily aggregates | No automatic expiry |
| Technical and public incidents, including their updates | No automatic expiry |

Deleting a monitor, deleting its history or restoring a backup can still remove
records. Previously expired records cannot be recovered by extending retention.
Storage grows with monitor count and retained history; review D1 usage as it grows.

Migration `0010_analytics.sql` adds hourly check/success counters and latency
sum/count without reconstructing measurements that were never stored. Existing
hourly rows initially retain null counters. The `hourly_metrics_since` timestamp
identifies the start of live collection, not a restriction on recovered history.
Migration `0011_hourly_measurements.sql` reconstructs missing hourly counters and
the partially collected migration hour from retained individual checks. It only
uses monitor-days whose check count, success count, latency sample count and
latency sum match the daily aggregates. Incomplete history stays unknown. The
repair preserves availability, degradation, incidents and notifications, and is
safe to repeat. Daily latency is already available for retained daily data.

## Credentials

In **Settings > Integrations**, create a named credential with a lifetime of
1–365 days (90 by default). Save the secret when shown: only its SHA-256 digest
is persisted. There can be at most 20 active credentials. Revoke any credential
from the same screen; expiration and revocation apply to REST and MCP immediately.
Every credential can read all monitors, including private incident notes and
sanitized diagnostics. It cannot read endpoint configuration, check credentials,
notification settings or other access tokens.

Send `Authorization: Bearer <credential>` on every request, over HTTPS.
Do not put credentials in URLs. They are independent of Access cookies and
administrative service tokens. Never distribute an administrative session to an
agent. Full database backups include credential digests; restoring one also
restores its unexpired credential grants, so revoke credentials as appropriate.

If Cloudflare Access currently protects the whole hostname, narrow the interactive
Access application to `/app/*` and `/api/v1/admin/*` (including their root paths),
or otherwise allow machine requests to `/mcp` and `/api/v1/analytics/*` to reach
the Worker. The Worker always requires its own analytics credential on those
routes, including local development. Do not remove protection from admin routes.
No infrastructure or Access policies are changed automatically by this feature.

## REST API and OpenAPI

The base path is `/api/v1/analytics`. All routes use GET and return JSON. Other
methods return 405. An authenticated OpenAPI 3.1 document is available at
`/api/v1/analytics/openapi.json`. Import it into an HTTP tool or agent supporting
OpenAPI, and configure the Bearer credential separately.

| Route | Purpose |
| --- | --- |
| `/info` | Retention, units and measurement limitations |
| `/monitors` | IDs, project/group IDs and current monitor status |
| `/metrics` | Paginated daily/hourly series and full-range daily summary |
| `/compare` | Baseline/current summaries, coverage and absolute deltas |
| `/incidents` | Paginated technical incidents overlapping a range |
| `/incidents/{id}` | Technical incident plus bounded communication/maintenance context |
| `/checks` | Paginated retained observations for one monitor |

Example using environment variables supplied by the caller:

```sh
curl "$MONITOR_ORIGIN/api/v1/analytics/metrics?start=2026-10-01&end=2026-10-15&granularity=day" \
  -H "Authorization: Bearer $MONITOR_ANALYTICS_TOKEN"
```

Date ranges use inclusive UTC dates `start` and `end`, with 1–366 days per query.
Future dates are rejected; the current day ends at the current time. Filters `project`, `group`, and
`monitor` accept UUIDs and intersect. Unknown, duplicate or invalid parameters
return 400. Use `/monitors` to discover IDs. `/checks` requires `monitor`.

`/metrics` supports `granularity=day|hour` (default day). `/incidents` supports
`status=all|open|resolved`. `/checks` supports
`result=all|success|failure|degraded`. Limits are at most 200 series/check rows or
100 incidents. Responses include `next_cursor`; keep the same filters and pass
that cursor until null. Cursors are positional, not a snapshot: current data may
change between requests. Series order is period then monitor ID; incidents and
checks are ordered newest first with ID tie-breakers.

For `/compare`, supply `baseline_start`, `baseline_end`, `start`, and `end` plus
optional scope filters, which apply to both periods. Deltas mean current minus
baseline. Availability changes are percentage points and latency changes are ms.
Missing measurements in either period yield null deltas for the affected metrics. `comparable_duration`
indicates whether the requested periods have the same number of days; inspect
coverage and effective end times before interpreting partial current periods.

Incident detail includes up to 50 overlapping public incident records, maintenance
windows and updates per collection. `truncated` identifies omitted context. The
technical `reason` is the observed failure category; public incident messages,
including provider-outage notices, are user-authored context rather than proof
of a root cause. Individual checks can be fetched separately for the incident's
monitor and date range, subject to their retention.

## MCP connection

The endpoint is `https://<your-host>/mcp`, using **Streamable HTTP**, JSON
responses and stateless requests. Use a client that supports an explicit
`Authorization` header. Interactive OAuth discovery/sign-in is not implemented;
clients that only accept OAuth connections can use the included stdio bridge
if they support local MCP servers, or use the REST API with OpenAPI instead.

Optional MCP fields may be omitted or set to null. Null scope filters mean all
projects/groups/monitors; null pagination, granularity and status fields use their
defaults. This also supports clients that normalize tool schemas into strict
function calling and require a value for every property. Never invent placeholder
UUIDs. Call `list_monitors` with `{}` or null scope fields to discover actual IDs.
After deploying a schema change, refresh tool discovery in the client. In
KIZUNA Assistant, use **Tools > Monitor > Manage > Test** ("Probar").

The seven tools are `get_data_policy`, `list_monitors`, `get_metrics`,
`compare_periods`, `list_incidents`, `get_incident` and `list_checks`. Every tool
is annotated read-only, idempotent and non-destructive. The SDK supplies protocol
initialization, tool discovery, validation and errors. Requests are capped at
64 KiB. Browser origins other than Monitor's configured origin are rejected.
There is no persistent MCP session or subscription stream.

For MCP clients supporting local stdio servers, configure a command using Node.js
22 or later and this checkout (after `pnpm install`):

```json
{
  "command": "node",
  "args": ["/absolute/path/to/monitor/scripts/mcp.mjs"],
  "env": {
    "MONITOR_ORIGIN": "https://monitor.example.com",
    "MONITOR_ANALYTICS_TOKEN": "<your-read-only-credential>"
  }
}
```

The bridge forwards discovery and tool calls to the HTTP server and writes only
MCP messages to stdout. Keep the credential in the client's private environment
or credential configuration.

With the official TypeScript SDK already installed in this project:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "monitor-analysis", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(
  new URL(`${process.env.MONITOR_ORIGIN}/mcp`),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.MONITOR_ANALYTICS_TOKEN}` } } }
));
try {
  const result = await client.callTool({
    name: "get_metrics",
    arguments: { start: "2026-10-01", end: "2026-10-15", granularity: "day" }
  });
  console.log(result.structuredContent);
} finally {
  await client.close();
}
```

## Interpretation

Availability is `up_seconds / observed_seconds * 100`. Summaries across monitors
combine observed monitor time, not the availability of a single service.
Maintenance and gaps without observations are excluded from this denominator;
missing observations are never converted to uptime. Summary coverage includes
selected monitor count, requested monitor-days and days with observed time.
A day with some observations is not necessarily a fully observed day: inspect
total observed seconds too. Monitors with no data remain in the summary.

Latency is `latency_sum / latency_count`, using successful checks with a
measurement. Aggregates cannot provide valid p95/p99 or explain root causes.
`/metrics` summaries always use the complete daily range even when its series is
hourly or paginated; do not add page summaries together. Hourly series can contain
null counters for legacy data and need not cover the full requested range.
Use daily data for long-range trends and retained checks for closer inspection.
`get_data_policy` includes `current_time` from the server in UTC. For a recent-hours
request, query hourly series across the relevant UTC dates, follow pagination and
select the applicable buckets. Report the actual bucket window, especially when
the requested boundary falls inside an hour. A daily summary spanning those dates
must not be presented as an exact rolling 48-hour summary.

Metrics in the dashboard supports custom UTC dates, project/group/monitor filters
and a JSON download of the selected daily dataset. This is an analysis report,
not a restorable database backup. Home and public pages have no new export controls.
