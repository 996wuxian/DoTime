import { describe, expect, it } from "vitest";
import type { Todo, TodoSubtask } from "../types";
import {
  getDailyPinnedTodos,
  reorderDailyPinnedTodos,
  setTodoDailyPinned,
  addDailyPinnedTodoToDate,
} from "./dailyPinnedTodos";

function createTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    title: id,
    urgency: "medium",
    date: "2026-10-08",
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
    createdAt: 1,
    completedAt: null,
    recurrenceSeriesId: null,
    recurrence: null,
    recurrenceTemplate: null,
    dailyPinned: true,
    ...overrides,
  };
}

function pinnedIds(todos: Todo[]): string[] {
  return getDailyPinnedTodos(todos).map((todo) => todo.id);
}

function completedSubtask(id: string, children: TodoSubtask[] = []): TodoSubtask {
  return {
    id, title: id, urgency: "high", plannedSeconds: 120, countdownEnabled: true,
    recordTimeEnabled: true, completed: true, isTiming: true, timingStartedAt: 123,
    elapsedSeconds: 90, actualDurationSeconds: 90, createdAt: 123, completedAt: 456,
    children,
  };
}

describe("adding daily pinned todos to a date", () => {
  const date = "2026-10-08";
  const options = { id: "new-todo", now: 1000, images: [] };

  it("creates a fresh occurrence and preserves the pinned source and its settings", () => {
    const source = createTodo("source", {
      title: "每日阅读", date: "2026-10-06", dailyPinnedSortOrder: 4000,
      completed: true, completedAt: 100, isTiming: true, timingStartedAt: 90,
      elapsedSeconds: 900, actualDurationSeconds: 900, plannedSeconds: 1800,
      countdownEnabled: true, reminderEnabled: true, reminderTime: "10:30",
      reminderSnoozedUntil: 100, reminderLastFiredAt: 100, favorite: true,
      urgency: "high", comment: "读书笔记", createdAt: new Date("2026-10-06T09:30:00").getTime(),
      recurrenceSeriesId: "old-series",
      recurrence: { frequency: "daily", weekdays: [], monthDay: null, endDate: null },
      subtasks: [completedSubtask("chapter", [completedSubtask("notes")])],
      images: [{ id: "image-1", name: "封面", fileName: "cover.png" }],
    });
    const todos = [source];
    const original = structuredClone(todos);
    const images = [{ id: "image-1", name: "封面", dataUrl: "data:image/png;base64,AAAA" }];

    const added = addDailyPinnedTodoToDate(todos, source.id, date, { ...options, images });
    const copy = added.todos[0];

    expect(added.result).toEqual({ status: "added", date, todoId: "new-todo" });
    expect(todos).toStrictEqual(original);
    expect(added.todos[1]).toBe(source);
    expect(copy).toMatchObject({
      id: "new-todo", date, title: "每日阅读", urgency: "high", comment: "读书笔记",
      plannedSeconds: 1800, countdownEnabled: true, reminderEnabled: true, reminderTime: "10:30",
      completed: false, completedAt: null, isTiming: false, timingStartedAt: null,
      elapsedSeconds: 0, actualDurationSeconds: null, reminderSnoozedUntil: null,
      reminderLastFiredAt: null, dailyPinned: false, favorite: false,
      recurrence: null, recurrenceSeriesId: null, recurrenceTemplate: null,
    });
    expect(copy.dailyPinnedSortOrder).toBeUndefined();
    expect(new Date(copy.createdAt).getHours()).toEqual(9);
    expect(new Date(copy.createdAt).getMinutes()).toEqual(30);
    expect(copy.images).toStrictEqual(images);
    expect(copy.images?.[0]).not.toBe(images[0]);
    expect(copy.subtasks?.[0]).toMatchObject({
      title: "chapter", urgency: "high", plannedSeconds: 120, completed: false,
      completedAt: null, isTiming: false, timingStartedAt: null, elapsedSeconds: 0,
      actualDurationSeconds: null,
    });
    expect(copy.subtasks?.[0].id).not.toEqual("chapter");
    expect(copy.subtasks?.[0].children[0]).toMatchObject({ title: "notes", completed: false, elapsedSeconds: 0 });
    expect(copy.subtasks?.[0].children[0].id).not.toEqual(copy.subtasks?.[0].id);
    expect(pinnedIds(added.todos)).toEqual(["source"]);
  });

  it.each([false, true])("finds same-title duplicates even when completed=%s", (completed) => {
    const source = createTodo("source", { title: " Read   Book ", date: "2026-10-07" });
    const duplicate = createTodo("existing", { title: "read book", completed, dailyPinned: false });
    const todos = [source, duplicate];

    const added = addDailyPinnedTodoToDate(todos, source.id, date, options);

    expect(added.result).toEqual({ status: "duplicate", date, todoId: "existing" });
    expect(added.todos).toBe(todos);
  });

  it("treats a pinned source already on that date as the duplicate", () => {
    const todos = [createTodo("source")];

    const added = addDailyPinnedTodoToDate(todos, "source", date, options);

    expect(added.result).toEqual({ status: "duplicate", date, todoId: "source" });
    expect(added.todos).toBe(todos);
  });

  it("adds only one occurrence when drops are repeated", () => {
    const source = createTodo("source", { date: "2026-10-07" });

    const first = addDailyPinnedTodoToDate([source], source.id, date, options);
    const second = addDailyPinnedTodoToDate(first.todos, source.id, date, { ...options, id: "second-copy" });

    expect(second.todos).toBe(first.todos);
    expect(second.result).toEqual({ status: "duplicate", date, todoId: "new-todo" });
  });

  it("allows the same title on other dates and inserts at the requested position", () => {
    const source = createTodo("source", { date: "2026-10-07" });
    const first = createTodo("first", { dailyPinned: false, sortOrder: 1000 });
    const second = createTodo("second", { dailyPinned: false, sortOrder: 3000 });
    const target = { targetId: "first", targetType: "todo", position: "after" } as const;

    const added = addDailyPinnedTodoToDate([source, first, second], source.id, date, { ...options, target });

    expect(added.todos[0].sortOrder).toEqual(2000);
    expect(added.todos.slice(1)).toStrictEqual([source, first, second]);
  });

  it("places a new occurrence next to category dividers", () => {
    const source = createTodo("source", { date: "2026-10-07" });
    const target = { targetId: "category", targetType: "category", position: "before" } as const;

    const added = addDailyPinnedTodoToDate([source], source.id, date, {
      ...options, target, categorySortOrders: new Map([["category", 3000], ["previous-category", 1000]]),
    });

    expect(added.todos[0].sortOrder).toEqual(2000);
  });

  it("starts a fresh countdown-only occurrence without inheriting elapsed time", () => {
    const source = createTodo("source", {
      date: "2026-10-07", countdownEnabled: true, countdownOnlyEnabled: true,
      plannedSeconds: 600, elapsedSeconds: 500, completed: true,
    });

    const added = addDailyPinnedTodoToDate([source], source.id, date, options);

    expect(added.todos[0]).toMatchObject({ isTiming: true, timingStartedAt: 1000, elapsedSeconds: 0, completed: false });
  });

  it.each(["missing", "ordinary"])("does not add a missing or unpinned source (%s)", (sourceId) => {
    const todos = [createTodo("ordinary", { dailyPinned: false })];

    const added = addDailyPinnedTodoToDate(todos, sourceId, date, options);

    expect(added.todos).toBe(todos);
    expect(added.result).toEqual({ status: "missing", date });
  });
});

describe("daily pinned todo ordering", () => {
  it("defaults to urgency then newest creation independently of date, day order, and completion", () => {
    const todos = [
      createTodo("first", { date: "2026-10-10", sortOrder: 9000, completed: true }),
      createTodo("ordinary", { dailyPinned: false }),
      createTodo("second", { date: "2026-10-01", sortOrder: 2000, urgency: "critical" }),
      createTodo("third", { sortOrder: 1000, isTiming: true, createdAt: 2 }),
    ];

    expect(pinnedIds(todos)).toEqual(["second", "third", "first"]);
  });

  it("uses explicit pinned order before the default order", () => {
    const todos = [
      createTodo("legacy-first"),
      createTodo("last", { dailyPinnedSortOrder: 3000, urgency: "critical" }),
      createTodo("first", { dailyPinnedSortOrder: 1000 }),
      createTodo("same-rank", { dailyPinnedSortOrder: 1000 }),
      createTodo("legacy-second", { dailyPinnedSortOrder: Number.NaN }),
    ];

    expect(pinnedIds(todos)).toEqual([
      "first", "same-rank", "last", "legacy-first", "legacy-second",
    ]);
  });

  it("moves pins across dates without changing their dates, day order, or completion", () => {
    const ordinary = createTodo("ordinary", { dailyPinned: false });
    const todos = [
      createTodo("first", { date: "2026-10-10", sortOrder: 3000 }),
      ordinary,
      createTodo("second", { date: "2026-10-01", sortOrder: 4000, completed: true }),
      createTodo("third", { sortOrder: 5000, isTiming: true }),
    ];
    const original = structuredClone(todos);

    const reordered = reorderDailyPinnedTodos(todos, "third", "first");

    expect(pinnedIds(reordered)).toEqual(["third", "first", "second"]);
    expect(todos).toStrictEqual(original);
    expect(reordered.map(({ id, date, sortOrder, completed, isTiming }) => ({
      id, date, sortOrder, completed, isTiming,
    }))).toStrictEqual(original.map(({ id, date, sortOrder, completed, isTiming }) => ({
      id, date, sortOrder, completed, isTiming,
    })));
    expect(reordered[1]).toBe(ordinary);
  });

  it("can insert after a target and keeps that order when completion changes", () => {
    const todos = [createTodo("first"), createTodo("second"), createTodo("third")];

    const reordered = reorderDailyPinnedTodos(todos, "first", "third", "after");
    const completed = reordered.map((todo) => ({ ...todo, completed: true }));

    expect(pinnedIds(completed)).toEqual(["second", "third", "first"]);
  });

  it.each([
    ["first", "first", "before"],
    ["missing", "second", "before"],
    ["first", "missing", "before"],
    ["ordinary", "first", "before"],
    ["first", "ordinary", "before"],
    ["first", "second", "before"],
    ["second", "first", "after"],
  ] as const)("does not change invalid or unchanged moves (%s, %s, %s)", (dragged, target, position) => {
    const todos = [
      createTodo("first"), createTodo("second"),
      createTodo("ordinary", { dailyPinned: false }),
    ];

    expect(reorderDailyPinnedTodos(todos, dragged, target, position)).toBe(todos);
  });

  it("keeps automatic ordering active when pinning without a manual order", () => {
    const todos = [
      createTodo("new", { dailyPinned: false, dailyPinnedSortOrder: -1000, urgency: "critical" }),
      createTodo("first"), createTodo("second"),
    ];

    const pinned = setTodoDailyPinned(todos, "new", true);

    expect(pinnedIds(pinned)).toEqual(["new", "first", "second"]);
    expect(pinned.every((todo) => todo.dailyPinnedSortOrder == null)).toBe(true);
    const updated = pinned.map((todo) => todo.id === "second" ? { ...todo, urgency: "critical" as const, createdAt: 2 } : todo);
    expect(pinnedIds(updated)).toEqual(["second", "new", "first"]);
    expect(todos[0].dailyPinned).toBe(false);
  });

  it("appends a re-pinned todo to the current end", () => {
    const todos = [createTodo("first"), createTodo("second"), createTodo("third")];
    const ordered = reorderDailyPinnedTodos(todos, "third", "first");

    const unpinned = setTodoDailyPinned(ordered, "third", false);
    const repinned = setTodoDailyPinned(unpinned, "third", true);

    expect(unpinned.find((todo) => todo.id === "third")?.dailyPinnedSortOrder).toBeUndefined();
    expect(pinnedIds(repinned)).toEqual(["first", "second", "third"]);
  });

  it("keeps unchanged and invalid pin requests as no-ops", () => {
    const todos = [createTodo("first"), createTodo("ordinary", { dailyPinned: false })];

    expect(setTodoDailyPinned(todos, "first", true)).toBe(todos);
    expect(setTodoDailyPinned(todos, "ordinary", false)).toBe(todos);
    expect(setTodoDailyPinned(todos, "missing", true)).toBe(todos);
  });
});
