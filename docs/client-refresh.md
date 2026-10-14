# Client refresh and mutations

`RefreshProvider` owns the refresh group for the mounted dashboard. Each non-empty
`useRefresh` query registers with this group and unregisters on path changes or
unmount. The header button refreshes all registered queries and waits for them to
finish. Manual refresh bypasses browser caching and replaces older in-flight
requests, whose results are ignored. Automatic polling remains every 30 seconds.

Use `useMutation().mutate<T>(path, method, payload)` for application writes. After
a successful request, it invalidates the group: any earlier refresh finishes
before a fresh read starts. Tokens and other response values are returned to the
caller. Read errors remain visible in the affected `useRefresh` consumer; they do
not turn a successful write into a failure that could cause an accidental retry.

For several writes forming one UI action, use `useMutation().batch(operations)`.
It waits for every write, refreshes once if any succeeded, and then reports a
write failure if needed. It is not a database transaction; successful writes are
retained when another operation fails. Mutations are never retried automatically.

This synchronizes queries mounted in the current dashboard. Views opened later
fetch their own data on mount. It does not add cross-tab or cross-user broadcasts.
Read-only POST operations, such as an unrecorded monitor test, continue to use
`api` without invalidating application data.
