ALTER TABLE pages ADD COLUMN included_ids TEXT;
UPDATE pages SET included_ids = (
  SELECT json_group_array(m.id) FROM monitors m
  WHERE m.project_id = pages.project_id
    AND (json_array_length(pages.group_ids) = 0 OR m.group_id IN (SELECT value FROM json_each(pages.group_ids)))
    AND m.id NOT IN (SELECT value FROM json_each(pages.excluded_ids))
);
CREATE TABLE hourly_stats (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  hour TEXT NOT NULL,
  observed_seconds INTEGER NOT NULL DEFAULT 0,
  up_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(monitor_id, hour)
);
CREATE INDEX hourly_retention ON hourly_stats(hour);
