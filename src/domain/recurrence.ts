import type { RecurrenceRule, RecurrenceTemplate, Todo } from "../types";
import { formatDateKey } from "../utils/time";
import { parseDateKey } from "../utils/calendar";

function getIsoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function normalizeRecurrenceRule(
  value: RecurrenceRule | null,
  fallbackDate: string,
): RecurrenceRule | null {
  if (value == null) return null;
  const fallback = parseDateKey(fallbackDate);
  const weekdays = [...new Set(value.weekdays)]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  return {
    frequency: value.frequency,
    weekdays:
      value.frequency === "weekly"
        ? weekdays.length > 0
          ? weekdays
          : [getIsoWeekday(fallback)]
        : [],
    monthDay:
      value.frequency === "monthly"
        ? Math.min(31, Math.max(1, value.monthDay ?? fallback.getDate()))
        : null,
    endDate: value.endDate && value.endDate >= fallbackDate ? value.endDate : null,
  };
}

export function getNextRecurrenceDate(
  currentDateKey: string,
  rule: RecurrenceRule,
): string | null {
  const current = parseDateKey(currentDateKey);
  let next: Date;

  switch (rule.frequency) {
    case "daily":
      next = new Date(current);
      next.setDate(next.getDate() + 1);
      break;
    case "weekdays": {
      next = new Date(current);
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() === 0 || next.getDay() === 6);
      break;
    }
    case "weekly": {
      const weekdays = new Set(rule.weekdays);
      next = new Date(current);
      do {
        next.setDate(next.getDate() + 1);
      } while (!weekdays.has(getIsoWeekday(next)));
      break;
    }
    case "monthly": {
      const requestedDay = rule.monthDay ?? current.getDate();
      const targetMonth = current.getMonth() + 1;
      const targetYear = current.getFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      const targetDay = Math.min(
        requestedDay,
        getDaysInMonth(targetYear, normalizedMonth),
      );
      next = new Date(targetYear, normalizedMonth, targetDay);
      break;
    }
  }

  const nextDateKey = formatDateKey(next);
  return rule.endDate != null && nextDateKey > rule.endDate ? null : nextDateKey;
}

function createOccurrenceId(now: number): string {
  return `${now}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createNextOccurrence(
  completedTodo: Todo,
  existingTodos: Todo[],
  now: number,
): Todo | null {
  if (completedTodo.recurrence == null || completedTodo.recurrenceSeriesId == null) {
    return null;
  }

  const nextDate = getNextRecurrenceDate(
    completedTodo.date,
    completedTodo.recurrence,
  );
  if (nextDate == null) return null;
  const duplicateExists = existingTodos.some(
    (todo) =>
      todo.recurrenceSeriesId === completedTodo.recurrenceSeriesId &&
      todo.date === nextDate,
  );
  if (duplicateExists) return null;

  const targetOrders = existingTodos
    .filter((todo) => todo.date === nextDate)
    .map((todo) => todo.sortOrder);
  const minSortOrder = Math.min(...targetOrders);
  const template = completedTodo.recurrenceTemplate ??
    createRecurrenceTemplate(completedTodo);

  return {
    ...completedTodo,
    ...template,
    id: createOccurrenceId(now),
    date: nextDate,
    sortOrder: Number.isFinite(minSortOrder) ? minSortOrder - 1000 : 1000,
    reminderSnoozedUntil: null,
    reminderLastFiredAt: null,
    completed: false,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    createdAt: now,
    completedAt: null,
  };
}

export function appendNextOccurrence(
  todos: Todo[],
  completedTodo: Todo,
  now: number,
): Todo[] {
  const nextOccurrence = createNextOccurrence(completedTodo, todos, now);
  return nextOccurrence == null ? todos : [nextOccurrence, ...todos];
}

export function createRecurrenceTemplate(
  todo: Pick<
    Todo,
    | "title"
    | "urgency"
    | "plannedSeconds"
    | "countdownEnabled"
    | "reminderEnabled"
    | "reminderTime"
    | "recordTimeEnabled"
  >,
): RecurrenceTemplate {
  return {
    title: todo.title,
    urgency: todo.urgency,
    plannedSeconds: todo.plannedSeconds,
    countdownEnabled: todo.countdownEnabled,
    reminderEnabled: todo.reminderEnabled,
    reminderTime: todo.reminderTime,
    recordTimeEnabled: todo.recordTimeEnabled,
  };
}
