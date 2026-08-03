import { describe, expect, it } from "vitest";
import type { Todo, TodoSubtask } from "../types";
import {
  applyReminderAction,
  applyReminderFired,
  addTodoSubtask,
  pauseTodoTiming,
  removeTodoSubtask,
  renameTodoSubtask,
  startTodoTiming,
  stopTodoTimingWithRecurrence,
  syncTodoSubtaskElapsedFromParent,
  toggleTodoSubtask,
  toggleTodoCompletion,
  toggleTodoCompletionWithRecurrence,
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
    recurrenceSeriesId: null,
    recurrence: null,
    recurrenceTemplate: null,
    subtasks: [],
    ...overrides,
  };
}

function subtask(
  overrides: Partial<TodoSubtask> & Pick<TodoSubtask, "id" | "title">,
): TodoSubtask {
  return {
    urgency: "medium",
    plannedSeconds: 0,
    countdownEnabled: false,
    recordTimeEnabled: false,
    completed: false,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    createdAt: 1,
    completedAt: null,
    children: [],
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

  it("starts eligible subtasks when the parent todo starts", () => {
    const todo = createTodo({
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "一级",
          recordTimeEnabled: true,
          children: [
            subtask({
              id: "subtask-2",
              title: "二级",
              recordTimeEnabled: true,
            }),
            subtask({
              id: "subtask-3",
              title: "不记录",
              recordTimeEnabled: false,
            }),
          ],
        }),
      ],
    });

    const result = startTodoTiming([todo], todo.id, 1000);
    const parent = result[0].subtasks?.[0];
    const timedChild = parent?.children[0];
    const untimedChild = parent?.children[1];

    expect(result[0].isTiming).toEqual(true);
    expect(parent?.isTiming).toEqual(true);
    expect(parent?.timingStartedAt).toEqual(1000);
    expect(timedChild?.isTiming).toEqual(true);
    expect(timedChild?.timingStartedAt).toEqual(1000);
    expect(untimedChild?.isTiming).toEqual(false);
  });

  it("pauses timing subtasks when the parent todo pauses", () => {
    const todo = createTodo({
      isTiming: true,
      timingStartedAt: 1000,
      elapsedSeconds: 10,
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "一级",
          recordTimeEnabled: true,
          isTiming: true,
          timingStartedAt: 1500,
          elapsedSeconds: 20,
          children: [
            subtask({
              id: "subtask-2",
              title: "二级",
              recordTimeEnabled: true,
              isTiming: true,
              timingStartedAt: 2000,
              elapsedSeconds: 30,
            }),
          ],
        }),
      ],
    });

    const result = pauseTodoTiming([todo], todo.id, 4500);
    const parent = result[0].subtasks?.[0];
    const child = parent?.children[0];

    expect(result[0].isTiming).toEqual(false);
    expect(result[0].elapsedSeconds).toEqual(13);
    expect(parent?.isTiming).toEqual(false);
    expect(parent?.timingStartedAt).toEqual(null);
    expect(parent?.elapsedSeconds).toEqual(23);
    expect(child?.isTiming).toEqual(false);
    expect(child?.elapsedSeconds).toEqual(32);
  });

  it("completes subtasks when the parent todo is completed", () => {
    const todo = createTodo({
      isTiming: true,
      timingStartedAt: 1000,
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "一级",
          recordTimeEnabled: true,
          isTiming: true,
          timingStartedAt: 2000,
          elapsedSeconds: 5,
          children: [
            subtask({
              id: "subtask-2",
              title: "二级",
              recordTimeEnabled: true,
            }),
          ],
        }),
      ],
    });

    const result = toggleTodoCompletion(todo, 5000);
    const parent = result.subtasks?.[0];
    const child = parent?.children[0];

    expect(result.completed).toEqual(true);
    expect(parent?.completed).toEqual(true);
    expect(parent?.isTiming).toEqual(false);
    expect(parent?.elapsedSeconds).toEqual(8);
    expect(parent?.actualDurationSeconds).toEqual(8);
    expect(child?.completed).toEqual(true);
    expect(child?.completedAt).toEqual(5000);
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
      recurrence: null,
      recurrenceEditScope: "series",
    });

    expect(result[0].date).toEqual("2026-07-30");
    expect(result[0].sortOrder).toEqual(0);
    expect(result[0].reminderLastFiredAt).toEqual(null);
    expect(result[0].reminderSnoozedUntil).toEqual(null);
  });

  it("creates one next occurrence when a recurring todo is completed", () => {
    const todo = createTodo({
      recurrenceSeriesId: "series-1",
      recurrence: {
        frequency: "daily",
        weekdays: [],
        monthDay: null,
        endDate: null,
      },
      recurrenceTemplate: {
        title: "测试待办",
        urgency: "medium",
        plannedSeconds: 1500,
        countdownEnabled: true,
        reminderEnabled: false,
        reminderTime: null,
        recordTimeEnabled: true,
      },
    });

    const result = toggleTodoCompletionWithRecurrence([todo], todo.id, 1000);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === todo.id)?.completed).toEqual(true);
    expect(result.find((item) => item.id !== todo.id)?.date).toEqual("2026-07-30");
  });

  it("creates one next occurrence when recurring timing is stopped", () => {
    const todo = createTodo({
      isTiming: true,
      timingStartedAt: 1000,
      recurrenceSeriesId: "series-1",
      recurrence: {
        frequency: "daily",
        weekdays: [],
        monthDay: null,
        endDate: null,
      },
      recurrenceTemplate: {
        title: "测试待办",
        urgency: "medium",
        plannedSeconds: 1500,
        countdownEnabled: true,
        reminderEnabled: false,
        reminderTime: null,
        recordTimeEnabled: true,
      },
    });

    const result = stopTodoTimingWithRecurrence([todo], todo.id, 5000);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === todo.id)?.actualDurationSeconds).toEqual(4);
    expect(result.find((item) => item.id !== todo.id)?.completed).toEqual(false);
  });

  it("completes subtasks when parent timing is stopped", () => {
    const todo = createTodo({
      isTiming: true,
      timingStartedAt: 1000,
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "一级",
          recordTimeEnabled: true,
          isTiming: true,
          timingStartedAt: 2000,
          elapsedSeconds: 5,
        }),
      ],
    });

    const result = stopTodoTimingWithRecurrence([todo], todo.id, 5000);
    const completedTodo = result.find((item) => item.id === todo.id);
    const completedSubtask = completedTodo?.subtasks?.[0];

    expect(completedTodo?.completed).toEqual(true);
    expect(completedSubtask?.completed).toEqual(true);
    expect(completedSubtask?.isTiming).toEqual(false);
    expect(completedSubtask?.elapsedSeconds).toEqual(8);
    expect(completedSubtask?.actualDurationSeconds).toEqual(8);
  });

  it("keeps the series template when editing only one occurrence", () => {
    const todo = createTodo({
      title: "系列标题",
      recurrenceSeriesId: "series-1",
      recurrence: {
        frequency: "daily",
        weekdays: [],
        monthDay: null,
        endDate: null,
      },
      recurrenceTemplate: {
        title: "系列标题",
        urgency: "medium",
        plannedSeconds: 1500,
        countdownEnabled: true,
        reminderEnabled: false,
        reminderTime: null,
        recordTimeEnabled: true,
      },
    });

    const result = updateTodoDetails([todo], todo.id, {
      title: "仅本次标题",
      date: todo.date,
      urgency: todo.urgency,
      plannedSeconds: todo.plannedSeconds,
      countdownEnabled: todo.countdownEnabled,
      reminderEnabled: todo.reminderEnabled,
      reminderTime: todo.reminderTime,
      recordTimeEnabled: todo.recordTimeEnabled,
      recurrence: todo.recurrence,
      recurrenceEditScope: "single",
    });

    expect(result[0].title).toEqual("仅本次标题");
    expect(result[0].recurrenceTemplate?.title).toEqual("系列标题");
  });

  it("updates the series template for this and following occurrences", () => {
    const todo = createTodo({
      title: "旧系列标题",
      recurrenceSeriesId: "series-1",
      recurrence: {
        frequency: "daily",
        weekdays: [],
        monthDay: null,
        endDate: null,
      },
      recurrenceTemplate: {
        title: "旧系列标题",
        urgency: "medium",
        plannedSeconds: 1500,
        countdownEnabled: true,
        reminderEnabled: false,
        reminderTime: null,
        recordTimeEnabled: true,
      },
    });

    const result = updateTodoDetails([todo], todo.id, {
      title: "新系列标题",
      date: todo.date,
      urgency: todo.urgency,
      plannedSeconds: todo.plannedSeconds,
      countdownEnabled: todo.countdownEnabled,
      reminderEnabled: todo.reminderEnabled,
      reminderTime: todo.reminderTime,
      recordTimeEnabled: todo.recordTimeEnabled,
      recurrence: todo.recurrence,
      recurrenceEditScope: "series",
    });

    expect(result[0].recurrenceTemplate?.title).toEqual("新系列标题");
  });

  it("adds top-level and second-level subtasks", () => {
    const todo = createTodo();
    const withParent = addTodoSubtask(
      [todo],
      todo.id,
      null,
      {
        title: "一级子待办",
        urgency: "high",
        plannedSeconds: 1500,
        countdownEnabled: true,
        recordTimeEnabled: true,
      },
      1000,
    );
    const parent = withParent[0].subtasks?.[0];

    expect(parent?.title).toEqual("一级子待办");
    expect(parent?.urgency).toEqual("high");
    expect(parent?.recordTimeEnabled).toEqual(true);

    const withChild = addTodoSubtask(
      withParent,
      todo.id,
      parent?.id ?? "",
      {
        title: "二级子待办",
        urgency: "medium",
        plannedSeconds: 0,
        countdownEnabled: false,
        recordTimeEnabled: false,
      },
      1001,
    );

    expect(withChild[0].subtasks?.[0].children[0].title).toEqual("二级子待办");
  });

  it("syncs a subtask elapsed time from its parent todo", () => {
    const todo = createTodo({
      plannedSeconds: 1800,
      countdownEnabled: true,
      isTiming: true,
      timingStartedAt: 2000,
      elapsedSeconds: 120,
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "子待办",
          plannedSeconds: 600,
          countdownEnabled: true,
          recordTimeEnabled: true,
          isTiming: true,
          timingStartedAt: 3000,
          elapsedSeconds: 10,
        }),
      ],
    });

    const result = syncTodoSubtaskElapsedFromParent(
      [todo],
      todo.id,
      "subtask-1",
      5000,
    );
    const synced = result[0].subtasks?.[0];

    expect(synced?.countdownEnabled).toEqual(true);
    expect(synced?.plannedSeconds).toEqual(600);
    expect(synced?.recordTimeEnabled).toEqual(true);
    expect(synced?.elapsedSeconds).toEqual(123);
    expect(synced?.timingStartedAt).toEqual(5000);
  });

  it("does not sync subtask elapsed time when the parent todo has no countdown", () => {
    const todo = createTodo({
      plannedSeconds: 0,
      countdownEnabled: false,
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "子待办",
          plannedSeconds: 0,
          countdownEnabled: false,
          recordTimeEnabled: false,
        }),
      ],
    });

    const result = syncTodoSubtaskElapsedFromParent(
      [todo],
      todo.id,
      "subtask-1",
      5000,
    );

    expect(result[0].subtasks?.[0]).toStrictEqual(todo.subtasks?.[0]);
  });

  it("renames, toggles, and removes subtasks", () => {
    const todo = createTodo({
      subtasks: [
        subtask({
          id: "subtask-1",
          title: "旧标题",
          children: [
            subtask({
              id: "subtask-2",
              title: "下级",
              createdAt: 2,
            }),
          ],
        }),
      ],
    });

    const renamed = renameTodoSubtask([todo], todo.id, "subtask-2", "新下级");
    const toggled = toggleTodoSubtask(renamed, todo.id, "subtask-2", 1000);
    const removed = removeTodoSubtask(toggled, todo.id, "subtask-1");

    expect(renamed[0].subtasks?.[0].children[0].title).toEqual("新下级");
    expect(toggled[0].subtasks?.[0].children[0].completed).toEqual(true);
    expect(removed[0].subtasks).toEqual([]);
  });
});
