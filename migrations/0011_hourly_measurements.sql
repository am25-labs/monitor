WITH candidates AS MATERIALIZED (
  SELECT monitor_id,hour,substr(hour,1,10) AS day
  FROM hourly_stats
  WHERE check_count IS NULL OR success_count IS NULL
    OR latency_sum IS NULL OR latency_count IS NULL
    OR hour=(SELECT strftime('%Y-%m-%dT%H',json_extract(value,'$.hourly_metrics_since'),'unixepoch') FROM app_settings WHERE id='analytics')
), days AS MATERIALIZED (
  SELECT DISTINCT monitor_id,day FROM candidates
), measurements AS MATERIALIZED (
  SELECT d.monitor_id,d.day,COUNT(r.id) AS check_count,
    COALESCE(SUM(r.ok),0) AS success_count,
    COALESCE(SUM(CASE WHEN r.ok=1 THEN COALESCE(r.latency,0) ELSE 0 END),0) AS latency_sum,
    COUNT(CASE WHEN r.ok=1 THEN r.latency END) AS latency_count
  FROM days d LEFT JOIN results r ON r.monitor_id=d.monitor_id
    AND r.checked_at>=unixepoch(d.day) AND r.checked_at<unixepoch(d.day)+86400
  GROUP BY d.monitor_id,d.day
), complete_days AS MATERIALIZED (
  SELECT m.monitor_id,m.day
  FROM measurements m JOIN daily_stats d ON d.monitor_id=m.monitor_id AND d.day=m.day
  WHERE m.check_count=d.check_count AND m.success_count=d.success_count
    AND m.latency_count=d.latency_count
    AND ABS(m.latency_sum-d.latency_sum)<=0.000000001*MAX(1,ABS(d.latency_sum))
), recovered AS MATERIALIZED (
  SELECT c.monitor_id,c.hour,COUNT(r.id) AS check_count,
    COALESCE(SUM(r.ok),0) AS success_count,
    COALESCE(SUM(CASE WHEN r.ok=1 THEN COALESCE(r.latency,0) ELSE 0 END),0) AS latency_sum,
    COUNT(CASE WHEN r.ok=1 THEN r.latency END) AS latency_count
  FROM candidates c JOIN complete_days d ON d.monitor_id=c.monitor_id AND d.day=c.day
  LEFT JOIN results r ON r.monitor_id=c.monitor_id
    AND r.checked_at>=unixepoch(c.hour||':00:00') AND r.checked_at<unixepoch(c.hour||':00:00')+3600
  GROUP BY c.monitor_id,c.hour
)
UPDATE hourly_stats AS h
SET check_count=r.check_count,success_count=r.success_count,
  latency_sum=r.latency_sum,latency_count=r.latency_count
FROM recovered r WHERE h.monitor_id=r.monitor_id AND h.hour=r.hour;
