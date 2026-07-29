import type { Todo } from "../types";
import type {
  ReminderActionPayload,
  ReminderFiredPayload,
} from "../utils/reminders";
import {
  getDefaultReminderTime,
  normalizeReminderTime,
} from "../utils/reminders";
import type { Urgency } from "../types";

export type TodoDetailsUpdate = {
  title: string;
  date: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
};

export function updateTodoDetails(
  todos: Todo[],
  id: string,
  updates: TodoDetailsUpdate,
): Todo[] {
  const trimmedTitle = updates.title.trim();
  if (!trimmedTitle || !updates.date) return todos;

  const currentTodo = todos.find((todo) => todo.id === id);
  if (currentTodo == null) return todos;
  const dateChanged = currentTodo.date !== updates.date;
  const targetSortOrders = todos
    .filter((todo) => todo.id !== id && todo.date === updates.date)
    .map((todo) => todo.sortOrder);
  const targetMinSortOrder = Math.min(...targetSortOrders);
  const movedSortOrder = Number.isFinite(targetMinSortOrder)
    ? targetMinSortOrder - 1000
    : 1000;

  return todos.map((todo) => {
    if (todo.id !== id) return todo;

    const keepTimingState = updates.recordTimeEnabled || !todo.isTiming;
    const nextReminderTime = updates.reminderEnabled
      ? normalizeReminderTime(updates.reminderTime) ?? getDefaultReminderTime()
      : null;
    const reminderChanged =
      dateChanged ||
      todo.reminderEnabled !== updates.reminderEnabled ||
      todo.reminderTime !== nextReminderTime;

    return {
      ...todo,
      title: trimmedTitle,
      date: updates.date,
      sortOrder: dateChanged ? movedSortOrder : todo.sortOrder,
      urgency: updates.urgency,
      countdownEnabled: updates.countdownEnabled,
      plannedSeconds: updates.countdownEnabled
        ? Math.max(60, updates.plannedSeconds)
        : 0,
      reminderEnabled: updates.reminderEnabled,
      reminderTime: nextReminderTime,
      recordTimeEnabled: updates.recordTimeEnabled,
      reminderSnoozedUntil: updates.reminderEnabled && !reminderChanged
        ? todo.reminderSnoozedUntil
        : null,
      reminderLastFiredAt: updates.reminderEnabled && !reminderChanged
        ? todo.reminderLastFiredAt
        : null,
      isTiming: keepTimingState ? todo.isTiming : false,
      timingStartedAt: keepTimingState ? todo.timingStartedAt : null,
    };
  });
}

export function startTodoTiming(
  todos: Todo[],
  id: string,
  now: number,
): Todo[] {
  return todos.map((todo) => {
    if (
      todo.id !== id ||
      todo.completed ||
      todo.isTiming ||
      !todo.recordTimeEnabled
    ) {
      return todo;
    }
    return { ...todo, isTiming: true, timingStartedAt: now };
  });
}

export function toggleTodoCompletion(todo: Todo, now: number): Todo {
  if (todo.completed) {
    const elapsedSeconds = Math.max(
      todo.elapsedSeconds,
      todo.actualDurationSeconds ?? 0,
    );
    const shouldResumeTiming = todo.recordTimeEnabled && elapsedSeconds > 0;

    return {
      ...todo,
      completed: false,
      completedAt: null,
      isTiming: shouldResumeTiming,
      timingStartedAt: shouldResumeTiming ? now : null,
      elapsedSeconds,
      actualDurationSeconds: null,
    };
  }

  let elapsedSeconds = todo.elapsedSeconds;
  if (todo.isTiming && todo.timingStartedAt != null) {
    elapsedSeconds += Math.floor((now - todo.timingStartedAt) / 1000);
  }

  return {
    ...todo,
    completed: true,
    completedAt: now,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds,
    actualDurationSeconds:
      elapsedSeconds > 0 ? elapsedSeconds : todo.actualDurationSeconds,
  };
}

export function applyReminderAction(
  todos: Todo[],
  action: ReminderActionPayload,
): Todo[] {
  const ids = new Set(action.ids);

  return todos.map((todo) =>
    ids.has(todo.id)
      ? {
          ...todo,
          reminderLastFiredAt: action.firedAt,
          reminderSnoozedUntil: action.snoozedUntil,
        }
      : todo,
  );
}

export function applyReminderFired(
  todos: Todo[],
  event: ReminderFiredPayload,
): Todo[] {
  const ids = new Set(event.ids);

  return todos.map((todo) =>
    ids.has(todo.id)
      ? {
          ...todo,
          reminderLastFiredAt: event.firedAt,
          reminderSnoozedUntil:
            todo.reminderSnoozedUntil != null &&
            todo.reminderSnoozedUntil <= event.firedAt
              ? null
              : todo.reminderSnoozedUntil,
        }
      : todo,
  );
}
