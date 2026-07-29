import type {
  RecurrenceEditScope,
  RecurrenceRule,
  Todo,
} from "../types";
import type {
  ReminderActionPayload,
  ReminderFiredPayload,
} from "../utils/reminders";
import {
  getDefaultReminderTime,
  normalizeReminderTime,
} from "../utils/reminders";
import type { Urgency } from "../types";
import {
  appendNextOccurrence,
  createRecurrenceTemplate,
  normalizeRecurrenceRule,
} from "./recurrence";

export type TodoDetailsUpdate = {
  title: string;
  date: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
  recurrence: RecurrenceRule | null;
  recurrenceEditScope: RecurrenceEditScope;
};

function createSeriesId(now = Date.now()): string {
  return `series-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

export function updateTodoDetails(
  todos: Todo[],
  id: string,
  updates: TodoDetailsUpdate,
): Todo[] {
  const trimmedTitle = updates.title.trim();
  if (!trimmedTitle || !updates.date) return todos;

  const currentTodo = todos.find((todo) => todo.id === id);
  if (currentTodo == null) return todos;
  const updateSeries =
    updates.recurrenceEditScope === "series" ||
    currentTodo.recurrenceSeriesId == null;
  const seriesRecurrence = updateSeries
    ? normalizeRecurrenceRule(updates.recurrence, updates.date)
    : currentTodo.recurrence;
  const occurrenceRecurrence =
    updates.recurrenceEditScope === "single"
      ? normalizeRecurrenceRule(updates.recurrence, updates.date)
      : seriesRecurrence;
  const nextSeriesId =
    seriesRecurrence == null
      ? null
      : currentTodo.recurrenceSeriesId ?? createSeriesId();
  const nextTemplate =
    seriesRecurrence == null
      ? null
      : updateSeries
        ? createRecurrenceTemplate({
            ...updates,
            plannedSeconds: updates.countdownEnabled
              ? Math.max(60, updates.plannedSeconds)
              : 0,
            reminderTime: updates.reminderEnabled
              ? normalizeReminderTime(updates.reminderTime) ??
                getDefaultReminderTime()
              : null,
          })
        : currentTodo.recurrenceTemplate;
  const dateChanged = currentTodo.date !== updates.date;
  const targetSortOrders = todos
    .filter((todo) => todo.id !== id && todo.date === updates.date)
    .map((todo) => todo.sortOrder);
  const targetMinSortOrder = Math.min(...targetSortOrders);
  const movedSortOrder = Number.isFinite(targetMinSortOrder)
    ? targetMinSortOrder - 1000
    : 1000;

  const retainedTodos = updateSeries && currentTodo.recurrenceSeriesId != null
    ? todos.filter(
        (todo) =>
          !(
            todo.recurrenceSeriesId === currentTodo.recurrenceSeriesId &&
            !todo.completed &&
            todo.date > currentTodo.date
          ),
      )
    : todos;
  const updatedTodos = retainedTodos.map((todo) => {
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
      recurrenceSeriesId: nextSeriesId,
      recurrence: occurrenceRecurrence,
      recurrenceTemplate: nextTemplate,
    };
  });

  const updatedCurrent = updatedTodos.find((todo) => todo.id === id);
  return updatedCurrent?.completed && updateSeries
    ? appendNextOccurrence(updatedTodos, updatedCurrent, Date.now())
    : updatedTodos;
}

export function toggleTodoCompletionWithRecurrence(
  todos: Todo[],
  id: string,
  now: number,
): Todo[] {
  const original = todos.find((todo) => todo.id === id);
  if (original == null) return todos;
  const updatedTodos = todos.map((todo) =>
    todo.id === id ? toggleTodoCompletion(todo, now) : todo,
  );
  if (original.completed) return updatedTodos;
  const completedTodo = updatedTodos.find((todo) => todo.id === id);
  return completedTodo == null
    ? updatedTodos
    : appendNextOccurrence(updatedTodos, completedTodo, now);
}

export function stopTodoTimingWithRecurrence(
  todos: Todo[],
  id: string,
  now: number,
): Todo[] {
  const current = todos.find((todo) => todo.id === id);
  if (current == null || !current.isTiming || current.timingStartedAt == null) {
    return todos;
  }

  const extra = Math.floor((now - current.timingStartedAt) / 1000);
  const total = current.elapsedSeconds + extra;
  const completedTodo: Todo = {
    ...current,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: total,
    actualDurationSeconds: total,
    completed: true,
    completedAt: now,
  };
  const updatedTodos = todos.map((todo) =>
    todo.id === id ? completedTodo : todo,
  );
  return appendNextOccurrence(updatedTodos, completedTodo, now);
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
