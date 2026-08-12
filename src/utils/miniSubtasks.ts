import type { Todo, TodoSubtask } from "../types";

export type MiniSubtaskItem = {
  id: string;
  title: string;
  urgency: TodoSubtask["urgency"];
  completed: boolean;
  countdownEnabled: boolean;
  recordTimeEnabled: boolean;
  plannedSeconds: number;
  elapsedSeconds: number;
  actualDurationSeconds: number | null;
  isTiming: boolean;
  timingStartedAt: number | null;
  level: number;
};

export type MiniSubtasksGroup = {
  todoId: string;
  parentTitle: string;
  items: MiniSubtaskItem[];
  updatedAt: number;
};

export const MINI_SUBTASKS_GROUP_EVENT = "dotime-mini-subtasks-group";
export const MINI_SUBTASKS_CLOSED_EVENT = "dotime-mini-subtasks-closed";
export const MINI_SUBTASKS_VISIBILITY_EVENT =
  "dotime-mini-subtasks-visibility";
export const MINI_SUBTASKS_HOVER_EVENT = "dotime-mini-subtasks-hover";

type ParsedMiniSubtasksGroup = {
  todoId: string;
  parentTitle: string;
  items: MiniSubtaskItem[];
  updatedAt: number;
};

export function flattenMiniSubtasks(
  subtasks: readonly TodoSubtask[] = [],
  level = 0,
): MiniSubtaskItem[] {
  return subtasks.flatMap((subtask) => [
    {
      id: subtask.id,
      title: subtask.title,
      urgency: subtask.urgency,
      completed: subtask.completed,
      countdownEnabled: subtask.countdownEnabled,
      recordTimeEnabled: subtask.recordTimeEnabled,
      plannedSeconds: subtask.plannedSeconds,
      elapsedSeconds: subtask.elapsedSeconds,
      actualDurationSeconds: subtask.actualDurationSeconds,
      isTiming: subtask.isTiming,
      timingStartedAt: subtask.timingStartedAt,
      level,
    },
    ...flattenMiniSubtasks(subtask.children, level + 1),
  ]);
}

export function buildMiniSubtasksGroup(todo: Todo): MiniSubtasksGroup | null {
  const items = flattenMiniSubtasks(todo.subtasks ?? []);
  if (items.length === 0) return null;
  return {
    todoId: todo.id,
    parentTitle: todo.title,
    items,
    updatedAt: Date.now(),
  };
}

export function buildMiniSubtasksGroupFromSubtasks(
  todoId: string,
  parentTitle: string,
  subtasks: readonly TodoSubtask[] = [],
): MiniSubtasksGroup | null {
  const items = flattenMiniSubtasks(subtasks);
  if (items.length === 0) return null;
  return {
    todoId,
    parentTitle,
    items,
    updatedAt: Date.now(),
  };
}

export function parseMiniSubtasksGroup(value: unknown): MiniSubtasksGroup | null {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as ParsedMiniSubtasksGroup;
    if (
      !parsed ||
      typeof parsed.todoId !== "string" ||
      typeof parsed.parentTitle !== "string" ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0 ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    const items = parsed.items.filter(
      (item): item is MiniSubtaskItem =>
        item != null &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.urgency === "string" &&
        typeof item.completed === "boolean" &&
        typeof item.countdownEnabled === "boolean" &&
        typeof item.recordTimeEnabled === "boolean" &&
        typeof item.plannedSeconds === "number" &&
        typeof item.elapsedSeconds === "number" &&
        (item.actualDurationSeconds == null ||
          typeof item.actualDurationSeconds === "number") &&
        typeof item.isTiming === "boolean" &&
        (item.timingStartedAt == null ||
          typeof item.timingStartedAt === "number") &&
        typeof item.level === "number",
    );

    if (items.length === 0) return null;

    return {
      todoId: parsed.todoId,
      parentTitle: parsed.parentTitle,
      items,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
