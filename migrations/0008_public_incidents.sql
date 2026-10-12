ALTER TABLE monitors ADD COLUMN latency_threshold INTEGER;
ALTER TABLE monitors ADD COLUMN degradation_threshold INTEGER NOT NULL DEFAULT 3;
ALTER TABLE monitors ADD COLUMN latency_recovery_threshold INTEGER NOT NULL DEFAULT 2;
ALTER TABLE monitors ADD COLUMN slow_checks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN fast_checks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitors ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE results ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hourly_stats ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE short_stats ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE public_incidents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK(origin IN ('automatic','manual')),
  monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE,
  technical_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  impact TEXT NOT NULL CHECK(impact IN ('degraded','down')),
  stage TEXT NOT NULL CHECK(stage IN ('investigating','identified','monitoring','resolved')),
  title_es TEXT NOT NULL DEFAULT '', title_en TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0, opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, closed_at INTEGER,
  CHECK((origin='automatic' AND monitor_id IS NOT NULL) OR (origin='manual' AND monitor_id IS NULL))
);
CREATE UNIQUE INDEX public_incidents_active ON public_incidents(monitor_id) WHERE origin='automatic' AND closed_at IS NULL;
CREATE INDEX public_incidents_history ON public_incidents(project_id,closed_at,opened_at,id);
CREATE TABLE incident_monitors (
  incident_id TEXT NOT NULL REFERENCES public_incidents(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY(incident_id,monitor_id)
);
CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES public_incidents(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('investigating','identified','monitoring','resolved')),
  impact TEXT NOT NULL CHECK(impact IN ('degraded','down')),
  message_es TEXT NOT NULL DEFAULT '', message_en TEXT NOT NULL DEFAULT '',
  event TEXT CHECK(event IN ('detected','changed','recovered')),
  created_at INTEGER NOT NULL
);
CREATE INDEX incident_monitors_scope ON incident_monitors(monitor_id,incident_id);
CREATE INDEX incident_updates_time ON incident_updates(incident_id,created_at,id);
INSERT INTO public_incidents(id,project_id,origin,monitor_id,technical_id,impact,stage,published,opened_at,updated_at,closed_at)
SELECT 'technical:'||i.id,m.project_id,'automatic',m.id,i.id,'down',CASE WHEN i.closed_at IS NULL THEN 'investigating' ELSE 'resolved' END,1,i.opened_at,COALESCE(i.closed_at,i.opened_at),i.closed_at FROM incidents i JOIN monitors m ON m.id=i.monitor_id;
INSERT INTO incident_monitors SELECT id,monitor_id FROM public_incidents;
INSERT INTO incident_updates(id,incident_id,stage,impact,event,created_at) SELECT id||':opened',id,'investigating','down','detected',opened_at FROM public_incidents;
INSERT INTO incident_updates(id,incident_id,stage,impact,event,created_at) SELECT id||':closed',id,'resolved','down','recovered',closed_at FROM public_incidents WHERE closed_at IS NOT NULL;
