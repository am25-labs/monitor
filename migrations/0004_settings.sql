CREATE TABLE app_settings (
  id TEXT PRIMARY KEY CHECK(id = 'notifications'),
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
