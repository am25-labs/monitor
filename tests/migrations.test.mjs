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
