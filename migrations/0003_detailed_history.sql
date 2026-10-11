CREATE TABLE short_stats (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  observed_seconds INTEGER NOT NULL DEFAULT 0,
  up_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(monitor_id, slot)
);
CREATE INDEX short_retention ON short_stats(slot);
