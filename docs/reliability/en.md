# Validate engine reliability

[Español](es.md)

The 100-monitor limit is a configuration capacity, not a guarantee that every check finishes exactly every 60 seconds. Timing depends on scheduler alarms, Queues delivery, D1, and the monitored service's timeout.

## Cycle scheduling

A Durable Object maintains a minute alarm and arms the next one before running the cycle. Cron starts the first alarm after deployment and recovers a missing alarm or one delayed by more than two minutes; it does not run checks directly. A failed cycle schedules a retry within 15 seconds. The normal deployment creates the scheduler binding and migration, without additional variables.

Alarms can also be delayed; this change reduces reliance on cron but requires production measurements. History retains solid colors based on observed checks; partial coverage for completed segments is available in the tooltip. “No data” indicates unconfirmed status, not service degradation.

## Engine protections

- Schedules a cycle's jobs in one transaction and publishes them in a batch of up to 100 messages.
- Claims dispatch atomically to prevent duplicate publications between concurrent cycles.
- Releases dispatch if publication fails. An ambiguous delivery may be repeated; job identifiers and leases still protect results.
- Cancels expired jobs before dispatch so an old backlog cannot block current checks. Cancelling a job does not check the service or create historical results.
- Allows up to 20 consumers of five messages, with concurrent checks inside each batch. This is a maximum; Cloudflare adjusts concurrency automatically.
- Preserves only the valid part of the previous result in history. Time after expiration remains unobserved.

## Local tests

Run `pnpm exec vitest run tests/engine.test.ts tests/scheduler.test.ts tests/history.test.ts` and `pnpm typecheck`.

Tests cover 25 and 100 monitors, concurrent cycles, recovery after publication failures, an expired backlog, retries without duplicate results, and 100 simultaneous 30-second timeouts. The last test requires persisting all 100 failures within 60 seconds after starting their consumers.

These tests use local D1 and Workers, and simulated HTTP responses. They do not reproduce production Queues delivery times or automatic scaling.

## Production measurements

After the usual deployment, open **Workers & Pages → your Worker → Observability → Logs**. Keep log capture enabled. Filter by these events:

| Event | Fields | Measurement |
| --- | --- | --- |
| `engine_cycle` | `schedulerDelaySeconds` | Delay between the scheduled time and the actual cycle start. |
| `engine_cycle` | `schedulingMs`, `dispatchMs`, `due`, `dispatched`, `cancelled` | Scheduler time, publication, and jobs discarded due to expiration, pauses, or configuration changes. |
| `engine_cycle` | `notificationsMs`, `cleanupMs`, `totalMs` | Time spent on the cycle's remaining operations. |
| `check_completed` | `jobAgeSeconds` | Time from the start of the cycle that created the job to its consumer start; includes scheduling and delivery. |
| `check_completed` | `checkGapSeconds` | Time between a monitor's results, measured when the check finishes and before persistence. |
| `check_completed` | `checkMs`, `persistenceMs`, `totalMs` | Check, write, and consumer execution durations. |
| `check_cancelled` | `reason`, `jobAgeSeconds` | Job that reached the consumer and was discarded. |
| `check_superseded` | `jobId` | Check whose result was not saved because another result, lease, or configuration change superseded it. |
| `check_execution_failure`, `engine_failure` | `stage`, when present | Internal failures requiring investigation. |

Logs do not include URLs, credentials, response bodies, or private diagnostics. Identifiers let you correlate jobs with their results in D1.

## Installation evaluation criteria

For HTTP/TCP monitors with a 60-second interval, initially use these operational targets:

- P95 of `schedulingMs + dispatchMs` below 5 seconds.
- P95 of `jobAgeSeconds` below 10 seconds; P99 below 30 seconds.
- P95 of `checkGapSeconds` up to 90 seconds; P99 up to 120 seconds.
- No sustained backlog growth or expiration cancellations during normal operation.
- No duplicate results and no unexplained internal failures.

These are validation targets, not a published SLA. Measure 24 hours to identify regressions and seven days to assess stability. Validate 100 monitors in a separate test installation, including fast responses, slow responses, timeouts, and simultaneous outages. Do not use a hundred third-party targets without authorization or alter real monitors for testing.

If the delay is in `schedulerDelaySeconds`, batching writes or increasing concurrency will not eliminate it. Alarms must be measured against the same criteria, along with monitoring the engine from an independent system. A stopped engine cannot guarantee that it will send an alert about its own stoppage.

Detection time includes the interval, timeout, and configured consecutive failed checks. Notification delivery adds provider and device time; it is not the same as detection time.

References: [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [batch publication](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [consumer concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/).
