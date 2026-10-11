CREATE TABLE maintenance_next (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('global','project','group','monitor')),
  target_id TEXT,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  CHECK(ends_at IS NULL OR ends_at > starts_at),
  CHECK((scope = 'global' AND target_id IS NULL) OR (scope != 'global' AND target_id IS NOT NULL))
);
INSERT INTO maintenance_next SELECT * FROM maintenance;
DROP TABLE maintenance;
ALTER TABLE maintenance_next RENAME TO maintenance;
CREATE INDEX maintenance_active ON maintenance(starts_at, ends_at);
