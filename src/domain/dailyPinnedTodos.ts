import type { Todo, TodoImage, TodoSubtask } from "../types";
import { compareTodoDefaultOrder } from "./todoOrdering";

export type DailyPinnedDropPosition = "before" | "after";

export type DailyPinnedDayDropTarget = {
  targetId: string;
  targetType: "todo" | "category";
  position: DailyPinnedDropPosition;
};

export type DailyPinnedAddResult =
  | { status: "added" | "duplicate"; todoId: string; date: string }
  | { status: "missing"; date: string };

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findDailyPinnedDuplicate(
  todos: readonly Todo[],
  source: Todo,
  date: string,
): Todo | undefined {
  const title = normalizeTitle(source.title);
  return todos.find((todo) => todo.date === date && normalizeTitle(todo.title) === title);
}

function cloneSubtasks(subtasks: readonly TodoSubtask[], id: string, now: number): TodoSubtask[] {
  return subtasks.map((subtask, index) => {
    const subtaskId = `${id}-subtask-${index}`;
    return {
      ...subtask,
      id: subtaskId,
      completed: false,
      completedAt: null,
      isTiming: false,
      timingStartedAt: null,
      elapsedSeconds: 0,
      actualDurationSeconds: null,
      createdAt: now,
      children: cloneSubtasks(subtask.children, subtaskId, now),
    };
  });
}

export function addDailyPinnedTodoToDate(
  todos: Todo[],
  sourceId: string,
  date: string,
  options: {
    id: string;
    now: number;
    images: readonly TodoImage[];
    target?: DailyPinnedDayDropTarget | null;
    categorySortOrders?: ReadonlyMap<string, number>;
  },
): { todos: Todo[]; result: DailyPinnedAddResult } {
  const source = todos.find((todo) => todo.id === sourceId && todo.dailyPinned);
  if (!source) return { todos, result: { status: "missing", date } };
  const duplicate = findDailyPinnedDuplicate(todos, source, date);
  if (duplicate) return { todos, result: { status: "duplicate", date, todoId: duplicate.id } };

  const sortOrders = [
    ...todos.filter((todo) => todo.date === date).map((todo) => todo.sortOrder),
    ...(options.categorySortOrders?.values() ?? []),
  ].filter(Number.isFinite);
  let sortOrder = sortOrders.length > 0 ? Math.min(...sortOrders) - 1000 : 1000;
  const target = options.target;
  const targetOrder = target?.targetType === "category"
    ? options.categorySortOrders?.get(target.targetId)
    : todos.find((todo) => todo.id === target?.targetId && todo.date === date)?.sortOrder;
  if (target && targetOrder != null && Number.isFinite(targetOrder)) {
    const adjacentOrders = sortOrders.filter((order) =>
      target.position === "before" ? order < targetOrder : order > targetOrder,
    );
    const neighbor = adjacentOrders.length === 0
      ? targetOrder + (target.position === "before" ? -2000 : 2000)
      : target.position === "before" ? Math.max(...adjacentOrders) : Math.min(...adjacentOrders);
    sortOrder = (targetOrder + neighbor) / 2;
  }
  const createdDate = new Date(`${date}T00:00:00`);
  const sourceDate = new Date(source.createdAt);
  createdDate.setHours(sourceDate.getHours(), sourceDate.getMinutes(), 0, 0);
  const countdownOnlyEnabled = Boolean(source.countdownEnabled && source.countdownOnlyEnabled);
  const todo: Todo = {
    ...source,
    id: options.id,
    date,
    sortOrder,
    title: source.title.trim(),
    favorite: false,
    dailyPinned: false,
    dailyPinnedSortOrder: undefined,
    completed: false,
    completedAt: null,
    isTiming: countdownOnlyEnabled,
    timingStartedAt: countdownOnlyEnabled ? options.now : null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    reminderSnoozedUntil: null,
    reminderLastFiredAt: null,
    recurrence: null,
    recurrenceSeriesId: null,
    recurrenceTemplate: null,
    createdAt: createdDate.getTime(),
    subtasks: cloneSubtasks(source.subtasks ?? [], options.id, options.now),
    images: options.images.map((image) => ({ ...image })),
  };
  return {
    todos: [todo, ...todos],
    result: { status: "added", date, todoId: todo.id },
  };
}

/** Explicit pinned positions take precedence over the default urgency/time order. */
export function getDailyPinnedTodos(todos: readonly Todo[]): Todo[] {
  return todos.filter((todo) => todo.dailyPinned).sort((a, b) => {
    const aOrder =
      a.dailyPinnedSortOrder != null && Number.isFinite(a.dailyPinnedSortOrder)
        ? a.dailyPinnedSortOrder
        : Number.POSITIVE_INFINITY;
    const bOrder =
      b.dailyPinnedSortOrder != null && Number.isFinite(b.dailyPinnedSortOrder)
        ? b.dailyPinnedSortOrder
        : Number.POSITIVE_INFINITY;
    if (aOrder === bOrder) return compareTodoDefaultOrder(a, b);
    return aOrder < bOrder ? -1 : 1;
  });
}

function applyDailyPinnedOrder(todos: Todo[], ordered: readonly Todo[]): Todo[] {
  const orderById = new Map(
    ordered.map((todo, index) => [todo.id, (index + 1) * 1000]),
  );
  return todos.map((todo) => {
    const dailyPinnedSortOrder = orderById.get(todo.id);
    return dailyPinnedSortOrder != null &&
      dailyPinnedSortOrder !== todo.dailyPinnedSortOrder
      ? { ...todo, dailyPinnedSortOrder }
      : todo;
  });
}

export function reorderDailyPinnedTodos(
  todos: Todo[],
  draggedId: string,
  targetId: string,
  position: DailyPinnedDropPosition = "before",
): Todo[] {
  if (draggedId === targetId) return todos;
  const ordered = getDailyPinnedTodos(todos);
  const draggedIndex = ordered.findIndex((todo) => todo.id === draggedId);
  if (draggedIndex < 0 || !ordered.some((todo) => todo.id === targetId)) {
    return todos;
  }

  const [dragged] = ordered.splice(draggedIndex, 1);
  const targetIndex = ordered.findIndex((todo) => todo.id === targetId);
  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  if (insertionIndex === draggedIndex) return todos;
  ordered.splice(insertionIndex, 0, dragged);
  return applyDailyPinnedOrder(todos, ordered);
}

export function setTodoDailyPinned(
  todos: Todo[],
  id: string,
  pinned: boolean,
): Todo[] {
  const target = todos.find((todo) => todo.id === id);
  if (target == null || Boolean(target.dailyPinned) === pinned) return todos;

  const updated = todos.map((todo) =>
    todo.id === id
      ? { ...todo, dailyPinned: pinned, dailyPinnedSortOrder: undefined }
      : todo,
  );
  if (!pinned) return updated;

  const ordered = getDailyPinnedTodos(todos);
  const hasManualOrder = ordered.some((todo) =>
    todo.dailyPinnedSortOrder != null && Number.isFinite(todo.dailyPinnedSortOrder),
  );
  return hasManualOrder ? applyDailyPinnedOrder(updated, [...ordered, target]) : updated;
}
