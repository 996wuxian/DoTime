import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import {
  DEFAULT_TODO_SEARCH_FILTERS,
  getTodoSearchStatus,
  isTodoSearchDateRangeInvalid,
  searchTodos,
  type TodoSearchFilters,
} from "./todoSearch";

function createTodo(overrides: Partial<Todo> & Pick<Todo, "id" | "date">): Todo {
  const { id, date, ...rest } = overrides;
  return {
    id,
    title: `任务 ${id}`,
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

function filters(overrides: Partial<TodoSearchFilters>): TodoSearchFilters {
  return { ...DEFAULT_TODO_SEARCH_FILTERS, ...overrides };
}

describe("todo search", () => {
  it("matches titles without case sensitivity", () => {
    const todos = [
      createTodo({ id: "one", date: "2026-07-29", title: "Release Notes" }),
      createTodo({ id: "two", date: "2026-07-29", title: "回归测试" }),
    ];

    expect(searchTodos(todos, filters({ query: "release" })).map((todo) => todo.id)).toEqual([
      "one",
    ]);
  });

  it.each([
    ["timing", { isTiming: true }, "timing"],
    ["completed", { completed: true }, "completed"],
    ["pending", {}, "pending"],
  ] as const)("classifies %s todos", (_name, overrides, expected) => {
    const todo = createTodo({ id: "status", date: "2026-07-29", ...overrides });

    expect(getTodoSearchStatus(todo)).toEqual(expected);
  });

  it("combines status, urgency, and inclusive date filters", () => {
    const todos = [
      createTodo({ id: "match", date: "2026-07-29", urgency: "critical" }),
      createTodo({ id: "wrong-date", date: "2026-07-31", urgency: "critical" }),
      createTodo({ id: "wrong-status", date: "2026-07-29", urgency: "critical", completed: true }),
    ];

    const result = searchTodos(
      todos,
      filters({
        status: "pending",
        urgency: "critical",
        startDate: "2026-07-28",
        endDate: "2026-07-29",
      }),
    );

    expect(result.map((todo) => todo.id)).toEqual(["match"]);
  });

  it("sorts timing, pending, and completed results in that order", () => {
    const result = searchTodos(
      [
        createTodo({ id: "done", date: "2026-07-31", completed: true }),
        createTodo({ id: "pending", date: "2026-07-30" }),
        createTodo({ id: "timing", date: "2026-07-29", isTiming: true }),
      ],
      DEFAULT_TODO_SEARCH_FILTERS,
    );

    expect(result.map((todo) => todo.id)).toEqual(["timing", "pending", "done"]);
  });

  it("rejects reversed date ranges", () => {
    const invalidFilters = filters({
      startDate: "2026-08-01",
      endDate: "2026-07-01",
    });

    expect(isTodoSearchDateRangeInvalid(invalidFilters)).toEqual(true);
    expect(
      searchTodos(
        [createTodo({ id: "todo", date: "2026-07-29" })],
        invalidFilters,
      ),
    ).toEqual([]);
  });
});
