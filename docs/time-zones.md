# Instance time zone

Settings → General selects an IANA time zone for the whole instance. Existing
instances default to UTC until a zone is saved. Choose `America/El_Salvador`
for Salvadoran time.

Dashboard timestamps, public pages, incident previews, notification messages,
history filters, and maintenance forms use this zone rather than the browser's
zone. Times use a 24-hour clock and show the UTC offset for the displayed instant.
For example, `2026-10-14T05:00:00Z` appears as
`13/10/2026, 23:00:00 (UTC-6)` in El Salvador.

Maintenance form values and history date boundaries are converted to Unix
timestamps in UTC. Nonexistent local times during daylight saving transitions
are rejected. If a local time repeats, the first occurrence is used.

Storage, scheduling, exports, and daily metric calculations remain in UTC.
Daily aggregate tables and chart labels explicitly say UTC; these buckets are
not reinterpreted as local calendar days. The selected zone is included in the
full backup's general settings. Legacy backups without it default to UTC.
