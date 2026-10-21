import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("provider outage migration preserves notification and general settings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory).sort()) {
      if (file >= "0009_provider_outage.sql") break;
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.exec("INSERT INTO app_settings VALUES('notifications','encrypted-fixture',1000),('general','{\"language\":\"en\"}',1001)");
    const before = db.prepare("SELECT * FROM app_settings ORDER BY id").all();
    db.exec(readFileSync(new URL("0009_provider_outage.sql", directory), "utf8"));
    assert.deepEqual(db.prepare("SELECT * FROM app_settings ORDER BY id").all(), before);
    db.exec("INSERT INTO app_settings VALUES('provider-outage','{}',1002)");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM app_settings").get().count, 3);
    assert.throws(() => db.exec("INSERT INTO app_settings VALUES('invalid','{}',1003)"));
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("public incident migration preserves existing history and backfills stable communication links", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory).sort()) {
      if (file >= "0008_public_incidents.sql") break;
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.exec(`
      INSERT INTO projects(id,name,created_at) VALUES('project','Project',1);
      INSERT INTO monitors(id,project_id,name,kind,config,interval_seconds,next_due,created_at)
        VALUES('monitor','project','Monitor','http','encrypted',60,1,1);
      INSERT INTO incidents VALUES('closed','monitor',100,200,'private diagnostic');
      INSERT INTO incidents VALUES('open','monitor',300,NULL,'private diagnostic');
      INSERT INTO results(job_id,monitor_id,checked_at,ok,latency,reason,diagnostic,observed_seconds,up_seconds)
        VALUES('job','monitor',301,1,4000,'ok','private diagnostic',60,60);
      INSERT INTO daily_stats(monitor_id,day,observed_seconds,up_seconds) VALUES('monitor','2026-10-11',600,540);
      INSERT INTO hourly_stats VALUES('monitor','2026-10-11T01',600,540);
      INSERT INTO short_stats VALUES('monitor','2026-10-11T01:00',60,60);
    `);
    const tables = [
      "monitors",
      "incidents",
      "results",
      "daily_stats",
      "hourly_stats",
      "short_stats"
    ];
    const before = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])
    );
    db.exec(
      readFileSync(new URL("0008_public_incidents.sql", directory), "utf8")
    );
    for (const table of tables) {
      const after = db.prepare(`SELECT * FROM ${table}`).all();
      assert.equal(after.length, before[table].length);
      for (let index = 0; index < after.length; index++) {
        for (const [key, value] of Object.entries(before[table][index]))
          assert.equal(after[index][key], value);
        if ("degraded" in after[index]) assert.equal(after[index].degraded, 0);
        if ("degraded_count" in after[index])
          assert.equal(after[index].degraded_count, 0);
      }
    }
    const reports = db
      .prepare("SELECT * FROM public_incidents ORDER BY opened_at")
      .all();
    assert.deepEqual(
      reports.map((report) => report.id),
      ["technical:closed", "technical:open"]
    );
    assert.deepEqual(
      reports.map((report) => report.technical_id),
      ["closed", "open"]
    );
    assert.deepEqual(
      reports.map((report) => report.stage),
      ["resolved", "investigating"]
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM incident_updates").get().count,
      3
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM incident_monitors").get().count,
      2
    );
    assert.equal(
      db.prepare("SELECT latency_threshold FROM monitors").get()
        .latency_threshold,
      null
    );
    assert.throws(() =>
      db.exec(`INSERT INTO public_incidents(id,project_id,origin,monitor_id,impact,stage,opened_at,updated_at)
      VALUES('duplicate','project','automatic','monitor','down','investigating',400,400)`)
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("analytics migration preserves history and leaves legacy hourly measurements unknown", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory).sort()) {
      if (file >= "0010_analytics.sql") break;
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.exec(`
      INSERT INTO projects(id,name,created_at) VALUES('project','Project',1);
      INSERT INTO monitors(id,project_id,name,kind,config,interval_seconds,next_due,created_at) VALUES('monitor','project','Monitor','http','encrypted',60,1,1);
      INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds,degraded_count) VALUES('monitor','2026-10-01T00',600,540,1);
      INSERT INTO app_settings VALUES('general','{"language":"en"}',1000),('provider-outage','{}',1001);
    `);
    const before = db.prepare("SELECT * FROM app_settings ORDER BY id").all();
    db.exec(readFileSync(new URL("0010_analytics.sql", directory), "utf8"));
    assert.deepEqual(db.prepare("SELECT * FROM app_settings WHERE id!='analytics' ORDER BY id").all(), before);
    const hourly = db.prepare("SELECT * FROM hourly_stats").get();
    assert.equal(hourly.observed_seconds, 600);
    assert.equal(hourly.up_seconds, 540);
    assert.equal(hourly.degraded_count, 1);
    for (const column of ["check_count", "success_count", "latency_sum", "latency_count"]) assert.equal(hourly[column], null);
    const metadata = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE id='analytics'").get().value);
    assert.deepEqual(metadata.tokens, []);
    assert.ok(metadata.hourly_metrics_since > 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

function hourlyRecoveryDatabase() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).sort()) {
    if (file >= "0011_hourly_measurements.sql") break;
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  db.exec(`
    INSERT INTO projects(id,name,created_at) VALUES('project','Project',1);
    INSERT INTO monitors(id,project_id,name,kind,config,interval_seconds,next_due,created_at)
      VALUES('monitor','project','Monitor','http','encrypted',60,1,1);
    UPDATE app_settings SET value=json_set(value,'$.hourly_metrics_since',unixepoch('2026-10-01T01:30:00')) WHERE id='analytics';
  `);
  return { db, migration: readFileSync(new URL("0011_hourly_measurements.sql", directory), "utf8") };
}

test("hourly recovery restores weighted measurements and the partial migration hour without changing other history", () => {
  const { db, migration } = hourlyRecoveryDatabase();
  try {
    db.exec(`
      INSERT INTO results(job_id,monitor_id,checked_at,ok,latency,reason,diagnostic,maintenance) VALUES
        ('a','monitor',unixepoch('2026-10-01T00:00:00'),1,100,'ok','',0),
        ('b','monitor',unixepoch('2026-10-01T00:59:59'),1,300,'ok','',0),
        ('c','monitor',unixepoch('2026-10-01T01:00:00'),1,200,'ok','',0),
        ('d','monitor',unixepoch('2026-10-01T01:01:00'),1,NULL,'ok','',0),
        ('e','monitor',unixepoch('2026-10-01T01:02:00'),0,999,'timeout','',0),
        ('f','monitor',unixepoch('2026-10-01T01:40:00'),1,500,'ok','',1),
        ('g','monitor',unixepoch('2026-10-01T02:00:00'),1,250,'ok','',0);
      INSERT INTO daily_stats(monitor_id,day,check_count,success_count,latency_sum,latency_count)
        VALUES('monitor','2026-10-01',7,6,1350,5);
      INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds,degraded_count,check_count,success_count,latency_sum,latency_count) VALUES
        ('monitor','2026-10-01T00',3600,3500,2,NULL,NULL,NULL,NULL),
        ('monitor','2026-10-01T01',3000,2800,3,1,1,500,1),
        ('monitor','2026-10-01T02',3600,3600,0,1,1,250,1),
        ('monitor','2026-10-01T03',60,60,0,NULL,NULL,NULL,NULL);
      INSERT INTO incidents VALUES('incident','monitor',100,200,'timeout');
      INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt,state)
        VALUES('notification','incident','opened','Monitor',100,100,'delivered');
    `);
    const tables = ["results", "daily_stats", "incidents", "notifications", "app_settings"];
    const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    const availability = db.prepare("SELECT monitor_id,hour,observed_seconds,up_seconds,degraded_count FROM hourly_stats ORDER BY hour").all();
    const complete = db.prepare("SELECT * FROM hourly_stats WHERE hour='2026-10-01T02'").get();
    db.exec(migration);
    const recovered = db.prepare("SELECT check_count,success_count,latency_sum,latency_count FROM hourly_stats ORDER BY hour").all();
    assert.deepEqual(recovered.map((row) => Object.values(row)), [
      [2, 2, 400, 2], [4, 3, 700, 2], [1, 1, 250, 1], [0, 0, 0, 0]
    ]);
    assert.equal((recovered[0].latency_sum + recovered[1].latency_sum) / (recovered[0].latency_count + recovered[1].latency_count), 275);
    assert.deepEqual(db.prepare("SELECT * FROM hourly_stats WHERE hour='2026-10-01T02'").get(), complete);
    assert.deepEqual(db.prepare("SELECT monitor_id,hour,observed_seconds,up_seconds,degraded_count FROM hourly_stats ORDER BY hour").all(), availability);
    for (const table of tables) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
    const after = db.prepare("SELECT * FROM hourly_stats ORDER BY hour").all();
    db.exec(migration);
    assert.deepEqual(db.prepare("SELECT * FROM hourly_stats ORDER BY hour").all(), after);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

for (const [column, value] of [["check_count", 2], ["success_count", 0], ["latency_sum", 500], ["latency_count", 0]]) {
  test(`hourly recovery leaves history unknown when daily ${column} disagrees`, () => {
    const { db, migration } = hourlyRecoveryDatabase();
    try {
      db.exec(`
        INSERT INTO results(job_id,monitor_id,checked_at,ok,latency,reason,diagnostic)
          VALUES('a','monitor',unixepoch('2026-10-01T00:00:00'),1,100,'ok','');
        INSERT INTO daily_stats(monitor_id,day,check_count,success_count,latency_sum,latency_count)
          VALUES('monitor','2026-10-01',1,1,100,1);
        UPDATE daily_stats SET ${column}=${value};
        INSERT INTO hourly_stats(monitor_id,hour) VALUES('monitor','2026-10-01T00');
      `);
      const before = db.prepare("SELECT * FROM hourly_stats").all();
      db.exec(migration);
      assert.deepEqual(db.prepare("SELECT * FROM hourly_stats").all(), before);
    } finally { db.close(); }
  });
}

test("job retention uses an indexed cutoff and preserves recent or unfinished work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory).sort()) {
      if (file >= "0012_jobs_retention.sql") break;
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.exec(`
      INSERT INTO projects(id,name,created_at) VALUES('project','Project',1);
      INSERT INTO monitors(id,project_id,name,kind,config,interval_seconds,next_due,created_at)
        VALUES('monitor','project','Monitor','http','encrypted',60,1,1);
      WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<2500)
      INSERT INTO jobs(id,monitor_id,config_version,due_at,state,completed_at)
        SELECT 'recent:'||n,'monitor',1,1,'completed',200 FROM entries;
      INSERT INTO jobs(id,monitor_id,config_version,due_at,state,completed_at) VALUES
        ('expired-completed','monitor',1,1,'completed',99),
        ('expired-cancelled','monitor',1,1,'cancelled',99),
        ('boundary','monitor',1,1,'completed',100),
        ('running','monitor',1,1,'running',NULL),
        ('pending','monitor',1,1,'pending',NULL);
    `);
    const before = db.prepare("SELECT * FROM jobs ORDER BY id").all();
    db.exec(readFileSync(new URL("0012_jobs_retention.sql", directory), "utf8"));
    assert.deepEqual(db.prepare("SELECT * FROM jobs ORDER BY id").all(), before);
    const sql = "DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE state IN ('completed','cancelled') AND completed_at<? LIMIT 1000)";
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(100);
    assert.ok(plan.some(({ detail }) => detail.includes("jobs_retention") && detail.includes("completed_at<?")));
    assert.equal(db.prepare(sql).run(100).changes, 2);
    assert.equal(db.prepare("SELECT count(*) AS total FROM jobs").get().total, 2503);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
