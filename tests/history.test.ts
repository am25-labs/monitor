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
