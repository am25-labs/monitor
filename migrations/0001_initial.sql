PRAGMA foreign_keys = ON;
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE groups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT, name TEXT NOT NULL, UNIQUE(project_id, name));
CREATE TABLE monitors (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('http','tcp','heartbeat')),
  config TEXT NOT NULL, config_version INTEGER NOT NULL DEFAULT 1,
  interval_seconds INTEGER NOT NULL CHECK(interval_seconds >= 60), grace_seconds INTEGER NOT NULL DEFAULT 60,
  failure_threshold INTEGER NOT NULL DEFAULT 2, recovery_threshold INTEGER NOT NULL DEFAULT 1,
  failures INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', paused INTEGER NOT NULL DEFAULT 0,
  next_due INTEGER NOT NULL, last_checked INTEGER, last_success INTEGER, last_latency REAL, last_ok INTEGER,
  last_heartbeat INTEGER, heartbeat_hash TEXT, maintenance_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX monitors_due ON monitors(paused, next_due);
CREATE INDEX monitors_project ON monitors(project_id, group_id);
CREATE TRIGGER monitors_capacity BEFORE INSERT ON monitors WHEN (SELECT COUNT(*) FROM monitors)>=100 BEGIN SELECT RAISE(ABORT,'monitor_capacity'); END;
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  config_version INTEGER NOT NULL, due_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', lease_token TEXT, lease_until INTEGER,
  dispatched_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, completed_at INTEGER
);
CREATE INDEX jobs_pending ON jobs(state, due_at);
CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL UNIQUE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at INTEGER NOT NULL, ok INTEGER NOT NULL, latency REAL, code INTEGER,
  reason TEXT NOT NULL, diagnostic TEXT NOT NULL, maintenance INTEGER NOT NULL DEFAULT 0,
  observed_seconds INTEGER NOT NULL DEFAULT 0, up_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX results_monitor_time ON results(monitor_id, checked_at DESC);
CREATE INDEX results_retention ON results(checked_at);
CREATE TABLE daily_stats (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, day TEXT NOT NULL,
  observed_seconds INTEGER NOT NULL DEFAULT 0, up_seconds INTEGER NOT NULL DEFAULT 0,
  check_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
  latency_sum REAL NOT NULL DEFAULT 0, latency_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(monitor_id, day)
);
CREATE INDEX daily_retention ON daily_stats(day);
CREATE TABLE incidents (
  id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  opened_at INTEGER NOT NULL, closed_at INTEGER, reason TEXT NOT NULL
);
CREATE UNIQUE INDEX incidents_open ON incidents(monitor_id) WHERE closed_at IS NULL;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,
  event TEXT NOT NULL, monitor_name TEXT NOT NULL, created_at INTEGER NOT NULL,
  next_attempt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending', lease_until INTEGER, lease_token TEXT,
  delivered_at INTEGER, error TEXT, UNIQUE(incident_id, event)
);
CREATE INDEX notifications_pending ON notifications(state, next_attempt);
CREATE TABLE maintenance (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('project','group','monitor')),
  target_id TEXT NOT NULL, title TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  CHECK(ends_at > starts_at)
);
CREATE INDEX maintenance_active ON maintenance(starts_at, ends_at);
CREATE TABLE pages (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  group_ids TEXT NOT NULL DEFAULT '[]', excluded_ids TEXT NOT NULL DEFAULT '[]', published INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE engine (id INTEGER PRIMARY KEY CHECK(id = 1), last_started INTEGER, last_finished INTEGER, last_error TEXT);
INSERT INTO engine(id) VALUES(1);
