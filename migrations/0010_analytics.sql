ALTER TABLE hourly_stats ADD COLUMN check_count INTEGER;
ALTER TABLE hourly_stats ADD COLUMN success_count INTEGER;
ALTER TABLE hourly_stats ADD COLUMN latency_sum REAL;
ALTER TABLE hourly_stats ADD COLUMN latency_count INTEGER;

CREATE TABLE app_settings_next (
  id TEXT PRIMARY KEY CHECK(id IN ('notifications', 'general', 'provider-outage', 'analytics')),
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO app_settings_next SELECT * FROM app_settings;
INSERT INTO app_settings_next(id,value,updated_at)
VALUES('analytics',json_object('hourly_metrics_since',unixepoch(),'tokens',json_array()),unixepoch());
DROP TABLE app_settings;
ALTER TABLE app_settings_next RENAME TO app_settings;
CREATE INDEX incidents_history ON incidents(opened_at,id);
