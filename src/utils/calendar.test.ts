import { describe, expect, it } from "vitest";
import { getCalendarDays, shiftDateKey, shiftMonth } from "./calendar";

describe("calendar utilities", () => {
  it("builds a stable six-week grid starting on Monday", () => {
    const days = getCalendarDays(new Date(2026, 6, 1));

    expect(days).toHaveLength(42);
    expect(days[0].dateKey).toEqual("2026-06-29");
    expect(days[41].dateKey).toEqual("2026-08-09");
  });

  it("shifts date keys across month boundaries", () => {
    expect(shiftDateKey("2026-07-31", 1)).toEqual("2026-08-01");
    expect(shiftDateKey("2026-03-01", -1)).toEqual("2026-02-28");
  });

  it("shifts month views across years", () => {
    const shifted = shiftMonth(new Date(2026, 11, 1), 1);

    expect(shifted.getFullYear()).toEqual(2027);
    expect(shifted.getMonth()).toEqual(0);
  });
});
