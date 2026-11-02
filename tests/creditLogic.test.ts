import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lateBucket,
  lateBucketCounts,
  midScore,
  monthsSince,
  formatBureauScores,
  validScore,
} from "../shared/creditLogic";

const today = new Date(2026, 10, 2); // 2026-11-02

test("monthsSince parses common date formats", () => {
  assert.equal(monthsSince("2026-11", today), 0);
  assert.equal(monthsSince("2025-11-15", today), 12);
  assert.equal(monthsSince("03/2024", today), 32);
  assert.equal(monthsSince("garbage", today), null);
  assert.equal(monthsSince("2027-01", today), null); // future
});

test("late payments land in exactly one bucket, date first", () => {
  assert.equal(lateBucket({ mostRecentLateDate: "2026-05" }, today), "within12");
  assert.equal(lateBucket({ mostRecentLateDate: "2025-01" }, today), "12to24");
  assert.equal(lateBucket({ mostRecentLateDate: "2020-01" }, today), "over24");
  // Date wins over a contradictory flag.
  assert.equal(lateBucket({ mostRecentLateDate: "2025-05", withinTwelveMonths: true }, today), "12to24");
  // No date: positive monthsSinceLate is used.
  assert.equal(lateBucket({ monthsSinceLate: 18 }, today), "12to24");
  // No date, 0 months: 0 meant "unknown" in older data, so fall back to the flag.
  assert.equal(lateBucket({ monthsSinceLate: 0, withinTwelveMonths: true }, today), "within12");
  assert.equal(lateBucket({ monthsSinceLate: 0, withinTwelveMonths: false }, today), "unknown");
});

test("bucket counts always add up to the total", () => {
  const list = [
    { mostRecentLateDate: "2026-05", withinTwelveMonths: true, monthsSinceLate: 18 },
    { mostRecentLateDate: "2025-01" },
    { monthsSinceLate: 0 },
    { mostRecentLateDate: "2019-02" },
  ];
  const c = lateBucketCounts(list, today);
  assert.equal(c.total, 4);
  assert.equal(c.within12 + c.between12And24 + c.over24 + c.unknown, 4);
  assert.deepEqual([c.within12, c.between12And24, c.over24, c.unknown], [1, 1, 1, 1]);
});

test("midScore: middle of 3, lower of 2, single, none", () => {
  assert.equal(midScore([702, 691, 708]), 702);
  assert.equal(midScore([702, null, 691]), 691);
  assert.equal(midScore([null, 745, undefined]), 745);
  assert.equal(midScore([null, null, null]), null);
  assert.equal(midScore([9999, 120, 700]), 700); // invalid scores ignored
});

test("validScore and formatBureauScores", () => {
  assert.equal(validScore(299), null);
  assert.equal(validScore("720"), 720);
  assert.equal(formatBureauScores(702, 691, 708), "Equifax 702 • Experian 691 • TransUnion 708");
  assert.equal(formatBureauScores(null, 691, 0), "Experian 691");
});
