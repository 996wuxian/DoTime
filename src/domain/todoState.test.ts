import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import {
  applyReminderAction,
  applyReminderFired,
  startTodoTiming,
  toggleTodoCompletion,
  updateTodoDetails,
} from "./todoState";

function createTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1",
    title: "测试待办",
    urgency: "medium",
    date: "2026-07-29",
    sortOrder: 1000,
    plannedSeconds: 1500,
    countdownEnabled: true,
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
    ...overrides,
  };
}

describe("todo timing state", () => {
  it("keeps other tasks timing when another task starts", () => {
    const timingTodo = createTodo({
      id: "todo-1",
      isTiming: true,
      timingStartedAt: 100,
    });
    const idleTodo = createTodo({ id: "todo-2" });

    const result = startTodoTiming([timingTodo, idleTodo], "todo-2", 200);

    expect(result[0]).toStrictEqual(timingTodo);
    expect(result[1].isTiming).toEqual(true);
    expect(result[1].timingStartedAt).toEqual(200);
  });

  it("resumes an elapsed task when completion is cancelled", () => {
    const todo = createTodo({
      completed: true,
      completedAt: 500,
      elapsedSeconds: 120,
      actualDurationSeconds: 120,
    });

    const result = toggleTodoCompletion(todo, 1000);

    expect(result.completed).toEqual(false);
    expect(result.isTiming).toEqual(true);
    expect(result.timingStartedAt).toEqual(1000);
    expect(result.actualDurationSeconds).toEqual(null);
  });

  it("does not resume when time recording is disabled", () => {
    const todo = createTodo({
      completed: true,
      recordTimeEnabled: false,
      elapsedSeconds: 120,
      actualDurationSeconds: 120,
    });

    const result = toggleTodoCompletion(todo, 1000);

    expect(result.isTiming).toEqual(false);
    expect(result.timingStartedAt).toEqual(null);
  });

  it("settles the active timing segment when completed", () => {
    const todo = createTodo({
      isTiming: true,
      timingStartedAt: 1000,
      elapsedSeconds: 30,
    });

    const result = toggleTodoCompletion(todo, 4500);

    expect(result.completed).toEqual(true);
    expect(result.elapsedSeconds).toEqual(33);
    expect(result.actualDurationSeconds).toEqual(33);
    expect(result.isTiming).toEqual(false);
  });

  it("applies reminder actions only to selected todos", () => {
    const first = createTodo({ id: "todo-1" });
    const second = createTodo({ id: "todo-2" });

    const result = applyReminderAction([first, second], {
      action: "snooze",
      ids: ["todo-2"],
      firedAt: 1000,
      snoozedUntil: 2000,
    });

    expect(result[0]).toStrictEqual(first);
    expect(result[1].reminderLastFiredAt).toEqual(1000);
    expect(result[1].reminderSnoozedUntil).toEqual(2000);
  });

  it("records native reminders as fired before the popup is dismissed", () => {
    const todo = createTodo({
      reminderSnoozedUntil: 900,
      reminderLastFiredAt: null,
    });

    const result = applyReminderFired([todo], {
      ids: [todo.id],
      firedAt: 1000,
    });

    expect(result[0].reminderLastFiredAt).toEqual(1000);
    expect(result[0].reminderSnoozedUntil).toEqual(null);
  });

  it("moves an edited todo to another date and resets its reminder state", () => {
    const moved = createTodo({
      id: "todo-1",
      reminderEnabled: true,
      reminderTime: "09:00",
      reminderLastFiredAt: 1000,
      reminderSnoozedUntil: 2000,
    });
    const target = createTodo({
      id: "todo-2",
      date: "2026-07-30",
      sortOrder: 1000,
    });

    const result = updateTodoDetails([moved, target], moved.id, {
      title: moved.title,
      date: "2026-07-30",
      urgency: moved.urgency,
      plannedSeconds: moved.plannedSeconds,
      countdownEnabled: moved.countdownEnabled,
      reminderEnabled: true,
      reminderTime: "09:00",
      recordTimeEnabled: true,
    });

    expect(result[0].date).toEqual("2026-07-30");
    expect(result[0].sortOrder).toEqual(0);
    expect(result[0].reminderLastFiredAt).toEqual(null);
    expect(result[0].reminderSnoozedUntil).toEqual(null);
  });
});
