import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import {
  buildStatisticsReport,
  getStatisticsRange,
  shiftStatisticsAnchor,
} from "./statistics";

function createTodo(overrides: Partial<Todo> & Pick<Todo, "id" | "date">): Todo {
  const { id, date, ...rest } = overrides;
  return {
    id,
    title: overrides.title ?? `任务 ${id}`,
    urgency: "medium",
    date,
    sortOrder: 1000,
    plannedSeconds: 0,
    countdownEnabled: false,
    reminderEnabled: false,
    reminderTime: null,
    recordTimeEnabled: true,
    reminderSnoozedUntil: null,
    reminderLastFiredAt: null,
    completed: false,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    createdAt: 0,
    completedAt: null,
    recurrenceSeriesId: null,
    recurrence: null,
    recurrenceTemplate: null,
    ...rest,
  };
}

describe("statistics", () => {
  it("uses Monday through Sunday for weekly ranges", () => {
    expect(getStatisticsRange("2026-07-29", "week")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-08-02",
    });
  });

  it("uses the complete calendar month and shifts anchors safely", () => {
    expect(getStatisticsRange("2028-02-14", "month")).toEqual({
      startDate: "2028-02-01",
      endDate: "2028-02-29",
    });
    expect(shiftStatisticsAnchor("2026-01-31", "month", 1)).toBe(
      "2026-02-28",
    );
    expect(shiftStatisticsAnchor("2026-07-29", "week", -1)).toBe(
      "2026-07-22",
    );
  });

  it("aggregates daily completion and elapsed time within the range", () => {
    const report = buildStatisticsReport(
      [
        createTodo({
          id: "done",
          date: "2026-07-27",
          completed: true,
          actualDurationSeconds: 1800,
        }),
        createTodo({
          id: "active",
          date: "2026-07-29",
          elapsedSeconds: 300,
          isTiming: true,
          timingStartedAt: 9_000,
        }),
        createTodo({ id: "outside", date: "2026-08-03", elapsedSeconds: 999 }),
      ],
      "2026-07-29",
      "week",
      69_000,
    );

    expect(report.total).toBe(2);
    expect(report.completed).toBe(1);
    expect(report.completionRate).toBe(0.5);
    expect(report.timing).toBe(1);
    expect(report.elapsedSeconds).toBe(2160);
    expect(report.days).toHaveLength(7);
    expect(report.days.find((day) => day.date === "2026-07-29")).toEqual({
      date: "2026-07-29",
      total: 1,
      completed: 0,
      elapsedSeconds: 360,
    });
    expect(report.topTasks.map((todo) => todo.id)).toEqual(["done", "active"]);
  });
});
