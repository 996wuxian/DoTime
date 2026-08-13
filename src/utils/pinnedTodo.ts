import type { Todo, Urgency } from "../types";

export const PINNED_TODO_EVENT = "dotime-pinned-todo";

export function pinnedTodoEventForSlot(slot: string) {
  return `${PINNED_TODO_EVENT}-${slot}`;
}

export function pinnedSubtasksExpandedEventForSlot(slot: string) {
  return `dotime-pinned-subtasks-expanded-${slot}`;
}

export type PinnedTodoPayload = {
  id: string;
  title: string;
  urgency: Urgency;
  date: string;
  plannedSeconds: number;
  countdownEnabled: boolean;
  recordTimeEnabled: boolean;
  completed: boolean;
  isTiming: boolean;
  timingStartedAt: number | null;
  elapsedSeconds: number;
  actualDurationSeconds: number | null;
  reminderEnabled: boolean;
  reminderTime: string | null;
  subtaskTotal: number;
  subtaskDone: number;
};

function countSubtasks(subtasks: Todo["subtasks"] = []) {
  let total = 0;
  let done = 0;

  for (const subtask of subtasks) {
    total += 1;
    if (subtask.completed) done += 1;
    for (const child of subtask.children) {
      total += 1;
      if (child.completed) done += 1;
    }
  }

  return { total, done };
}

export function buildPinnedTodoPayload(todo: Todo): PinnedTodoPayload {
  const subtaskStats = countSubtasks(todo.subtasks);

  return {
    id: todo.id,
    title: todo.title,
    urgency: todo.urgency,
    date: todo.date,
    plannedSeconds: todo.plannedSeconds,
    countdownEnabled: todo.countdownEnabled,
    recordTimeEnabled: todo.recordTimeEnabled,
    completed: todo.completed,
    isTiming: todo.isTiming,
    timingStartedAt: todo.timingStartedAt,
    elapsedSeconds: todo.elapsedSeconds,
    actualDurationSeconds: todo.actualDurationSeconds,
    reminderEnabled: todo.reminderEnabled,
    reminderTime: todo.reminderTime,
    subtaskTotal: subtaskStats.total,
    subtaskDone: subtaskStats.done,
  };
}

export function parsePinnedTodoPayload(value: unknown): PinnedTodoPayload | null {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as Partial<PinnedTodoPayload>;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.title !== "string") {
      return null;
    }
    return parsed as PinnedTodoPayload;
  } catch {
    return null;
  }
}
