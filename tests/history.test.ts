import { expect, it } from "vitest";
import { historySegments } from "../src/shared/history";
import type { MonitorHistory } from "../src/shared/types";

it("aligns each history range to its UTC buckets and keeps gaps unknown", () => {
  const updatedAt = Date.parse("2026-10-13T06:02:00Z") / 1000;
  const history: MonitorHistory = {
    updatedAt,
    short: [{ slot: "2026-10-13T06:00", observed_seconds: 60, up_seconds: 60 }],
    hourly: [{ hour: "2026-10-13T06", observed_seconds: 60, up_seconds: 60 }],
    stats: [{ day: "2026-10-13", observed_seconds: 60, up_seconds: 60 }]
  };
  for (const [range, count, stride] of [["1h", 12, 300], ["24h", 288, 300], ["7d", 168, 3600], ["90d", 90, 86400]] as const) {
    const segments = historySegments(history, range);
    expect(segments).toHaveLength(count);
    expect(segments.at(-1)?.state).toBe("up");
    expect(segments[0].state).toBe("none");
    expect(segments.at(-1)!.start - segments[0].start).toBe((count - 1) * stride);
  }
});

it("uses one color per bucket with outage priority without penalizing latency availability", () => {
  const history: MonitorHistory = {
    updatedAt: Date.parse("2026-10-13T06:02:00Z") / 1000,
    stats: [], hourly: [],
    short: [
      { slot: "2026-10-13T05:50", observed_seconds: 300, up_seconds: 299, degraded_count: 1 },
      { slot: "2026-10-13T05:55", observed_seconds: 300, up_seconds: 300, degraded_count: 1 },
      { slot: "2026-10-13T06:00", observed_seconds: 0, up_seconds: 0 }
    ]
  };
  expect(historySegments(history, "1h").slice(-3).map((segment) => segment.state)).toEqual(["down", "degraded", "none"]);
  expect(historySegments(history, "1h").at(-2)?.stat?.up_seconds).toBe(300);
});

it("exposes partial coverage without changing colors or flagging the ongoing bucket", () => {
  const history: MonitorHistory = {
    updatedAt: Date.parse("2026-10-13T06:02:00Z") / 1000,
    stats: [], hourly: [],
    short: [
      { slot: "2026-10-13T05:55", observed_seconds: 235, up_seconds: 235 },
      { slot: "2026-10-13T06:00", observed_seconds: 60, up_seconds: 60 }
    ]
  };
  const segments = historySegments(history, "24h");
  expect(segments.at(-2)).toMatchObject({ state: "up", partial: true, expected: 300 });
  expect(segments.at(-2)?.coverage).toBeCloseTo(78.333);
  expect(segments.at(-1)).toMatchObject({ state: "up", partial: false, expected: 120 });
  expect(segments[0]).toMatchObject({ state: "none", partial: false, coverage: 0 });
});

it("classifies hourly and daily availability using exact 99.9% and 95% boundaries", () => {
  const updatedAt = Date.parse("2026-10-13T06:02:00Z") / 1000;
  for (const [observed, up, expected] of [
    [86400, 86340, "up"],
    [3600, 3540, "degraded"],
    [86400, 79200, "down"],
    [1000, 999, "up"],
    [1000000, 998999, "degraded"],
    [1000, 950, "degraded"],
    [1000000, 949999, "down"],
    [60, 0, "down"], [60, 60, "up"], [0, 0, "none"]
  ] as const) {
    const stat = { observed_seconds: observed, up_seconds: up };
    const history: MonitorHistory = {
      updatedAt, short: [],
      hourly: [{ ...stat, hour: "2026-10-13T06" }],
      stats: [{ ...stat, day: "2026-10-13" }]
    };
    for (const range of ["7d", "90d"] as const)
      expect(historySegments(history, range).at(-1)?.state).toBe(expected);
  }
});

it("preserves latency degradation independently of aggregate availability", () => {
  const history: MonitorHistory = {
    updatedAt: Date.parse("2026-10-13T06:02:00Z") / 1000, short: [],
    hourly: [{ hour: "2026-10-13T06", observed_seconds: 3600, up_seconds: 3600, degraded_count: 1 }],
    stats: [{ day: "2026-10-13", observed_seconds: 86400, up_seconds: 86340, degraded_count: 1 }]
  };
  for (const range of ["7d", "90d"] as const)
    expect(historySegments(history, range).at(-1)?.state).toBe("degraded");
});

it("colors maintenance without observations and merges overlapping windows without treating them as missing coverage", () => {
  const start = Date.parse("2026-10-13T06:00:00Z") / 1000;
  const history: MonitorHistory = {
    updatedAt: start + 600, stats: [], hourly: [],
    short: [{ slot: "2026-10-13T06:00", observed_seconds: 180, up_seconds: 180 }],
    maintenance: [
      { starts_at: start + 60, ends_at: start + 150 },
      { starts_at: start + 120, ends_at: start + 180 },
      { starts_at: start + 300, ends_at: null },
      { starts_at: start + 900, ends_at: null }
    ]
  };
  expect(historySegments(history, "24h").at(-3)).toMatchObject({ state: "maintenance", maintenance: 120, coverage: 100, partial: false });
  expect(historySegments(history, "24h").at(-2)).toMatchObject({ state: "maintenance", maintenance: 300 });
  expect(historySegments(history, "24h").at(-1)).toMatchObject({ state: "none", maintenance: 0 });
  expect(historySegments(history, "24h").at(-4)?.state).toBe("none");
});

it("keeps outages and latency degradation visible when maintenance overlaps the same bucket", () => {
  const start = Date.parse("2026-10-13T06:00:00Z") / 1000;
  const history: MonitorHistory = {
    updatedAt: start + 120, stats: [], hourly: [],
    short: [{ slot: "2026-10-13T06:00", observed_seconds: 60, up_seconds: 0 }],
    maintenance: [{ starts_at: start + 60, ends_at: null }]
  };
  expect(historySegments(history, "24h").at(-1)).toMatchObject({ state: "down", maintenance: 60 });
  history.short[0] = { ...history.short[0], up_seconds: 60, degraded_count: 1 };
  expect(historySegments(history, "24h").at(-1)?.state).toBe("degraded");
});
