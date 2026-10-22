import type { Todo, TodoSubtask, TrashEntry } from "../types";
import { removeTodoSubtask } from "./todoState";

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export interface RecycleState { todos: Todo[]; trash: TrashEntry[] }

export function purgeTrash(state: RecycleState, ids: Iterable<string>): RecycleState {
  const selected = new Set(ids);
  const trash = state.trash.filter(entry => !selected.has(entry.id));
  return trash.length === state.trash.length ? state : { ...state, trash };
}

export function expireTrash(state: RecycleState, now: number): RecycleState {
  const trash = state.trash.filter(entry => entry.deletedAt + TRASH_RETENTION_MS > now);
  return trash.length === state.trash.length ? state : { ...state, trash };
}

function pause<T extends Pick<Todo, "isTiming" | "timingStartedAt" | "elapsedSeconds">>(item: T, now: number): T {
  return {
    ...item,
    elapsedSeconds: item.elapsedSeconds + (item.isTiming && item.timingStartedAt != null
      ? Math.max(0, Math.floor((now - item.timingStartedAt) / 1000)) : 0),
    isTiming: false,
    timingStartedAt: null,
  };
}

function pauseSubtask(item: TodoSubtask, now: number): TodoSubtask {
  return { ...pause(item, now), children: item.children.map(child => pauseSubtask(child, now)) };
}

function pauseTodo(todo: Todo, now: number): Todo {
  return { ...pause(todo, now), subtasks: todo.subtasks?.map(item => pauseSubtask(item, now)) };
}

export function archiveTodos(state: RecycleState, ids: Iterable<string>, now: number, batchId: string,
  metadata: Pick<TrashEntry, "categoryDividers" | "manualSort"> = {}): RecycleState {
  const selected = new Set(ids);
  const removed = state.todos.filter(todo => selected.has(todo.id));
  if (removed.length === 0) return state;
  return {
    todos: state.todos.filter(todo => !selected.has(todo.id)),
    trash: [...removed.map(todo => ({ ...metadata, id: `${batchId}:${todo.id}`, batchId,
      deletedAt: now, todo: pauseTodo(todo, now) })), ...state.trash],
  };
}

function findSubtask(items: readonly TodoSubtask[], id: string): NonNullable<TrashEntry["subtask"]> | null {
  for (let index = 0; index < items.length; index++) {
    const value = items[index];
    if (value.id === id) return { value, parentId: null, index, beforeId: items[index - 1]?.id, afterId: items[index + 1]?.id };
    const child = value.children.findIndex(item => item.id === id);
    if (child !== -1) return { value: value.children[child], parentId: value.id, index: child, beforeId: value.children[child - 1]?.id, afterId: value.children[child + 1]?.id };
  }
  return null;
}

export function archiveSubtask(state: RecycleState, todoId: string, subtaskId: string, now: number, batchId: string): RecycleState {
  const todo = state.todos.find(item => item.id === todoId);
  const found = todo && findSubtask(todo.subtasks ?? [], subtaskId);
  if (!todo || !found) return state;
  return {
    todos: removeTodoSubtask(state.todos, todoId, subtaskId),
    trash: [{ id: `${batchId}:${subtaskId}`, batchId, deletedAt: now,
      todo: { ...pauseTodo(todo, now), images: [], subtasks: [] },
      subtask: { ...found, value: pauseSubtask(found.value, now) } }, ...state.trash],
  };
}

export function getTrashRestoreBlocker(entry: TrashEntry, todos: readonly Todo[]): string | null {
  const parent = todos.find(todo => todo.id === entry.todo.id);
  if (!entry.subtask) return parent ? "同一待办已存在，无法覆盖现有内容" : null;
  if (!parent) return "请先恢复所属待办";
  const { value, parentId } = entry.subtask;
  const ids = new Set([value.id, ...value.children.map(child => child.id)]);
  if ((parent.subtasks ?? []).some(item => ids.has(item.id) || item.children.some(child => ids.has(child.id)))) {
    return "同一子待办已存在，无法覆盖现有内容";
  }
  if (parentId && !(parent.subtasks ?? []).some(item => item.id === parentId)) return "请先恢复上级子待办";
  return null;
}

export function restoreTrash(state: RecycleState, ids: Iterable<string>, now: number): RecycleState {
  const selected = new Set(ids);
  let todos = state.todos;
  const restored = new Set<string>();
  // Parents must be restored before their children, regardless of deletion order.
  const entries = state.trash.filter(entry => selected.has(entry.id));
  for (let pass = 0; pass < 3; pass++) {
    for (const entry of entries) {
      if (restored.has(entry.id) || entry.deletedAt + TRASH_RETENTION_MS <= now || getTrashRestoreBlocker(entry, todos)) continue;
      if (!entry.subtask) {
        const todo = { ...entry.todo, countdownOnlyEnabled: false,
          reminderLastFiredAt: Math.max(entry.todo.reminderLastFiredAt ?? 0, now) };
        todos = [...todos, todo];
      } else {
        const { value, parentId, index, beforeId, afterId } = entry.subtask;
        const insert = (items: TodoSubtask[]) => {
          const next = [...items];
          const after = next.findIndex(item => item.id === afterId);
          const before = next.findIndex(item => item.id === beforeId);
          next.splice(after !== -1 ? after : before !== -1 ? before + 1 : Math.min(index, next.length), 0, value);
          return next;
        };
        todos = todos.map(todo => todo.id !== entry.todo.id ? todo : { ...todo,
          subtasks: parentId == null ? insert(todo.subtasks ?? [])
            : (todo.subtasks ?? []).map(item => item.id === parentId ? { ...item, children: insert(item.children) } : item) });
      }
      restored.add(entry.id);
    }
  }
  return restored.size ? { todos, trash: state.trash.filter(entry => !restored.has(entry.id)) } : state;
}

export function getRetainedImageTodos(todos: readonly Todo[], trash: readonly TrashEntry[]): Todo[] {
  const owners = new Map<string, Todo>();
  for (const todo of [...todos, ...trash.filter(entry => !entry.subtask).map(entry => entry.todo)]) {
    const previous = owners.get(todo.id);
    const images = new Map((previous?.images ?? []).map(image => [image.id, image]));
    for (const image of todo.images ?? []) images.set(image.id, image);
    owners.set(todo.id, { ...todo, images: [...images.values()] });
  }
  return [...owners.values()];
}
