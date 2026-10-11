CREATE TABLE app_settings_next (
  id TEXT PRIMARY KEY CHECK(id IN ('notifications', 'general')),
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO app_settings_next SELECT * FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_next RENAME TO app_settings;
ALTER TABLE pages ADD COLUMN language TEXT NOT NULL DEFAULT 'es' CHECK(language IN ('es', 'en'));
