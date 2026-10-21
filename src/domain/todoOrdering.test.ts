import { describe, expect, it } from "vitest";
import type { Todo, TodoCategoryDivider } from "../types";
import { addDailyPinnedTodoToDate } from "./dailyPinnedTodos";
import { getDayTodos, getTodoTimelineItems, materializeDayTodoOrder } from "./todoOrdering";

const date = "2026-10-21";

function createTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id, title: id, date, urgency: "medium", sortOrder: 1000, createdAt: 1,
    plannedSeconds: 0, countdownEnabled: false, reminderEnabled: false,
    reminderTime: null, recordTimeEnabled: true, reminderSnoozedUntil: null,
    reminderLastFiredAt: null, completed: false, isTiming: false,
    timingStartedAt: null, elapsedSeconds: 0, actualDurationSeconds: null,
    completedAt: null, recurrenceSeriesId: null, recurrence: null,
    recurrenceTemplate: null, ...overrides,
  };
}

describe("day todo ordering", () => {
  it("orders by urgency then newest creation without mutating the source", () => {
    const todos = [
      createTodo("low", { urgency: "low", createdAt: 100, sortOrder: -1000, isTiming: true }),
      createTodo("medium"),
      createTodo("old-high", { urgency: "high", createdAt: 2 }),
      createTodo("urgent", { urgency: "critical", completed: true, sortOrder: 9000 }),
      createTodo("new-high", { urgency: "high", createdAt: 3 }),
      createTodo("other-day", { date: "2026-10-20", urgency: "critical" }),
    ];
    const original = structuredClone(todos);

    const ordered = getDayTodos(todos, date, false);
    const displayed = getTodoTimelineItems(ordered, []);

    expect(ordered.map((todo) => todo.id)).toEqual(["urgent", "new-high", "old-high", "medium", "low"]);
    expect(displayed.map((item) => item.type === "todo" && item.todo.id)).toEqual(ordered.map((todo) => todo.id));
    expect(todos).toStrictEqual(original);
  });

  it("keeps explicit day positions ahead of urgency and creation", () => {
    const todos = [
      createTodo("urgent", { urgency: "critical", sortOrder: 3000, createdAt: 10 }),
      createTodo("first", { urgency: "low", sortOrder: 1000 }),
    ];

    expect(getDayTodos(todos, date, true).map((todo) => todo.id)).toEqual(["first", "urgent"]);
  });

  it("preserves the displayed order when inserting the first category divider", () => {
    const otherDay = createTodo("other-day", { date: "2026-10-20" });
    const todos = [createTodo("low", { urgency: "low" }), otherDay, createTodo("urgent", { urgency: "critical", sortOrder: 9000 })];

    const frozen = materializeDayTodoOrder(todos, date);
    const ordered = getDayTodos(frozen, date, true);
    const divider: TodoCategoryDivider = {
      id: "category", title: "Category", date,
      sortOrder: (ordered[0].sortOrder + ordered[1].sortOrder) / 2,
      createdAt: 1, updatedAt: 1,
    };
    const timeline = getTodoTimelineItems(ordered, [divider]);

    expect(timeline.map((item) => item.type === "todo" ? item.todo.id : item.divider.id)).toEqual(["urgent", "category", "low"]);
    expect(frozen[1]).toBe(otherDay);
    expect(todos[0].sortOrder).toBe(1000);
  });

  it("places a pinned copy at its drop target without rearranging the other displayed todos", () => {
    const todos = [
      createTodo("low", { urgency: "low", sortOrder: 1000 }),
      createTodo("urgent", { urgency: "critical", sortOrder: 9000 }),
      createTodo("source", { date: "2026-10-20", dailyPinned: true }),
    ];

    const frozen = materializeDayTodoOrder(todos, date);
    const added = addDailyPinnedTodoToDate(frozen, "source", date, {
      id: "copy", now: 1000, images: [],
      target: { targetId: "urgent", targetType: "todo", position: "after" },
    });

    expect(getDayTodos(added.todos, date, true).map((todo) => todo.id)).toEqual(["urgent", "copy", "low"]);
  });
});
