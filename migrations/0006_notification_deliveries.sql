CREATE TABLE notification_deliveries (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email','telegram','pushover','ntfy')),
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  delivered_at INTEGER,
  error TEXT,
  receipt TEXT,
  receipt_token TEXT,
  cancelled_at INTEGER,
  PRIMARY KEY(notification_id, channel)
);
CREATE INDEX notification_deliveries_pending ON notification_deliveries(state, next_attempt);
