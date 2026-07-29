import { describe, expect, it } from "vitest";
import type { RecurrenceRule, Todo } from "../types";
import {
  createNextOccurrence,
  getNextRecurrenceDate,
} from "./recurrence";

function createRule(
  overrides: Partial<RecurrenceRule> = {},
): RecurrenceRule {
  return {
    frequency: "daily",
    weekdays: [],
    monthDay: null,
    endDate: null,
    ...overrides,
  };
}

function createTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1",
    title: "重复待办",
    urgency: "medium",
    date: "2026-07-31",
    sortOrder: 1000,
    plannedSeconds: 1500,
    countdownEnabled: true,
    reminderEnabled: true,
    reminderTime: "09:00",
    recordTimeEnabled: true,
    reminderSnoozedUntil: null,
    reminderLastFiredAt: 100,
    completed: true,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 300,
    actualDurationSeconds: 300,
    createdAt: 1,
    completedAt: 1000,
    recurrenceSeriesId: "series-1",
    recurrence: createRule(),
    recurrenceTemplate: {
      title: "重复待办",
      urgency: "medium",
      plannedSeconds: 1500,
      countdownEnabled: true,
      reminderEnabled: true,
      reminderTime: "09:00",
      recordTimeEnabled: true,
    },
    ...overrides,
  };
}

describe("recurrence dates", () => {
  it.each([
    ["daily", "2026-07-31", "2026-08-01"],
    ["weekdays", "2026-07-31", "2026-08-03"],
  ] as const)("calculates %s recurrence", (frequency, current, expected) => {
    expect(
      getNextRecurrenceDate(current, createRule({ frequency })),
    ).toEqual(expected);
  });

  it("uses the next selected weekday", () => {
    const rule = createRule({ frequency: "weekly", weekdays: [1, 3] });

    expect(getNextRecurrenceDate("2026-07-27", rule)).toEqual("2026-07-29");
    expect(getNextRecurrenceDate("2026-07-29", rule)).toEqual("2026-08-03");
  });

  it("clamps monthly recurrences to the last day of shorter months", () => {
    const rule = createRule({ frequency: "monthly", monthDay: 31 });

    expect(getNextRecurrenceDate("2026-01-31", rule)).toEqual("2026-02-28");
    expect(getNextRecurrenceDate("2028-01-31", rule)).toEqual("2028-02-29");
  });

  it("stops after the configured end date", () => {
    const rule = createRule({ endDate: "2026-08-01" });

    expect(getNextRecurrenceDate("2026-07-31", rule)).toEqual("2026-08-01");
    expect(getNextRecurrenceDate("2026-08-01", rule)).toEqual(null);
  });
});

describe("recurrence occurrences", () => {
  it("creates a clean next occurrence from the series template", () => {
    const completed = createTodo({ title: "仅本次改名" });

    const next = createNextOccurrence(completed, [completed], 2000);

    expect(next?.date).toEqual("2026-08-01");
    expect(next?.title).toEqual("重复待办");
    expect(next?.completed).toEqual(false);
    expect(next?.elapsedSeconds).toEqual(0);
    expect(next?.reminderLastFiredAt).toEqual(null);
  });

  it("does not create a duplicate occurrence for the same series and date", () => {
    const completed = createTodo();
    const existing = createTodo({ id: "todo-2", date: "2026-08-01" });

    expect(createNextOccurrence(completed, [completed, existing], 2000)).toEqual(
      null,
    );
  });
});
