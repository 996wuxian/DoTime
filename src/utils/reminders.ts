import type { Todo } from "../types";

export const TODO_STORAGE_KEY = "dotime-todos-v1";
export const ACTIVE_REMINDER_STORAGE_KEY = "dotime-active-reminder-v1";

export type ActiveReminderItem = {
  id: string;
  title: string;
  reminderTime: string;
  dueAt: number;
};

export type ActiveReminderGroup = {
  id: string;
  firedAt: number;
  updatedAt: number;
  items: ActiveReminderItem[];
};

export const SNOOZE_MINUTES = [5, 10, 30, 60] as const;

export function getDefaultReminderTime(now = new Date()): string {
  const date = new Date(now);
  date.setMinutes(date.getMinutes() + 30);
  date.setSeconds(0, 0);
  return formatTimeInput(date);
}

export function normalizeReminderTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getReminderDueAt(todo: Todo): number | null {
  if (!todo.reminderEnabled || todo.completed) return null;
  const reminderTime = normalizeReminderTime(todo.reminderTime);
  if (!reminderTime) return null;

  if (
    todo.reminderSnoozedUntil != null &&
    todo.reminderSnoozedUntil > (todo.reminderLastFiredAt ?? 0)
  ) {
    return todo.reminderSnoozedUntil;
  }

  const [year, month, day] = todo.date.split("-").map(Number);
  const [hour, minute] = reminderTime.split(":").map(Number);
  const due = new Date(year, month - 1, day, hour, minute, 0, 0);
  return due.getTime();
}

export function isTodoReminderDue(todo: Todo, now: number): boolean {
  const dueAt = getReminderDueAt(todo);
  if (dueAt == null || now < dueAt) return false;
  return todo.reminderLastFiredAt == null || todo.reminderLastFiredAt < dueAt;
}

export function createReminderItem(todo: Todo): ActiveReminderItem | null {
  const dueAt = getReminderDueAt(todo);
  const reminderTime = normalizeReminderTime(todo.reminderTime);
  if (dueAt == null || reminderTime == null) return null;

  return {
    id: todo.id,
    title: todo.title,
    reminderTime,
    dueAt,
  };
}

export function readActiveReminderGroup(): ActiveReminderGroup | null {
  try {
    const raw = localStorage.getItem(ACTIVE_REMINDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveReminderGroup;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveReminderGroup(group: ActiveReminderGroup | null) {
  if (group == null || group.items.length === 0) {
    localStorage.removeItem(ACTIVE_REMINDER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(ACTIVE_REMINDER_STORAGE_KEY, JSON.stringify(group));
}

export function mergeActiveReminderItems(
  current: ActiveReminderGroup | null,
  incoming: ActiveReminderItem[],
  now: number,
): ActiveReminderGroup {
  const itemsById = new Map<string, ActiveReminderItem>();

  current?.items.forEach((item) => itemsById.set(item.id, item));
  incoming.forEach((item) => itemsById.set(item.id, item));

  return {
    id: current?.id ?? `reminder-${now}`,
    firedAt: current?.firedAt ?? now,
    updatedAt: now,
    items: [...itemsById.values()].sort((a, b) => a.dueAt - b.dueAt),
  };
}

function formatTimeInput(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}
