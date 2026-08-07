import type {
  RecurrenceEditScope,
  RecurrenceRule,
  Todo,
  TodoImage,
  TodoSubtask,
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
  taskTime?: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
  recurrence: RecurrenceRule | null;
  recurrenceEditScope: RecurrenceEditScope;
  images?: TodoImage[];
};

function getDateTimeTimestamp(dateKey: string, time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  const date = new Date(`${dateKey}T00:00:00`);
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.getTime();
}

export type SubtaskDetails = Pick<
  TodoSubtask,
  | "title"
  | "urgency"
  | "plannedSeconds"
  | "countdownEnabled"
  | "recordTimeEnabled"
>;

function createSeriesId(now = Date.now()): string {
  return `series-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

function createSubtaskId(now = Date.now()): string {
  return `subtask-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

function settleSubtaskTiming(subtask: TodoSubtask, now: number): TodoSubtask {
  if (!subtask.isTiming || subtask.timingStartedAt == null) return subtask;
  const extra = Math.floor((now - subtask.timingStartedAt) / 1000);
  return {
    ...subtask,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: subtask.elapsedSeconds + extra,
  };
}

function startSubtaskTiming(subtask: TodoSubtask, now: number): TodoSubtask {
  if (subtask.completed || subtask.isTiming || !subtask.recordTimeEnabled) {
    return subtask;
  }

  return {
    ...subtask,
    isTiming: true,
    timingStartedAt: now,
  };
}

function toggleSubtaskCompletion(subtask: TodoSubtask, now: number): TodoSubtask {
  if (subtask.completed) {
    const elapsedSeconds = Math.max(
      subtask.elapsedSeconds,
      subtask.actualDurationSeconds ?? 0,
    );
    const shouldResumeTiming = subtask.recordTimeEnabled;

    return {
      ...subtask,
      completed: false,
      completedAt: null,
      isTiming: shouldResumeTiming,
      timingStartedAt: shouldResumeTiming ? now : null,
      elapsedSeconds,
      actualDurationSeconds: null,
    };
  }

  const settled = settleSubtaskTiming(subtask, now);
  return {
    ...settled,
    completed: true,
    completedAt: now,
    actualDurationSeconds:
      settled.elapsedSeconds > 0
        ? settled.elapsedSeconds
        : settled.actualDurationSeconds,
  };
}

function completeSubtask(subtask: TodoSubtask, now: number): TodoSubtask {
  const settled = settleSubtaskTiming(subtask, now);
  if (settled.completed) return settled;

  return {
    ...settled,
    completed: true,
    completedAt: now,
    actualDurationSeconds:
      settled.elapsedSeconds > 0
        ? settled.elapsedSeconds
        : settled.actualDurationSeconds,
  };
}

function uncompleteSubtask(subtask: TodoSubtask, now: number): TodoSubtask {
  const elapsedSeconds = Math.max(
    subtask.elapsedSeconds,
    subtask.actualDurationSeconds ?? 0,
  );
  const shouldResumeTiming = subtask.recordTimeEnabled;

  return {
    ...subtask,
    completed: false,
    completedAt: null,
    isTiming: shouldResumeTiming,
    timingStartedAt: shouldResumeTiming ? now : null,
    elapsedSeconds,
    actualDurationSeconds: null,
  };
}

function updateSubtasks(
  subtasks: readonly TodoSubtask[] = [],
  updater: (subtask: TodoSubtask, depth: 1 | 2) => TodoSubtask | null,
  depth: 1 | 2 = 1,
): TodoSubtask[] {
  return subtasks
    .map((subtask) => {
      const updated = updater(subtask, depth);
      if (updated == null) return null;
      if (depth === 2) return updated;
      return {
        ...updated,
        children: updateSubtasks(updated.children, updater, 2),
      };
    })
    .filter((subtask): subtask is TodoSubtask => subtask != null);
}

function reorderSubtasksInSiblings(
  subtasks: readonly TodoSubtask[] = [],
  draggedId: string,
  targetId: string,
): { subtasks: TodoSubtask[]; changed: boolean } {
  const draggedIndex = subtasks.findIndex((subtask) => subtask.id === draggedId);
  const targetIndex = subtasks.findIndex((subtask) => subtask.id === targetId);

  if (draggedIndex >= 0 || targetIndex >= 0) {
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      return { subtasks: [...subtasks], changed: false };
    }

    const reordered = [...subtasks];
    const [dragged] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, dragged);
    return { subtasks: reordered, changed: true };
  }

  let changed = false;
  const nextSubtasks = subtasks.map((subtask) => {
    const childResult = reorderSubtasksInSiblings(
      subtask.children,
      draggedId,
      targetId,
    );
    if (!childResult.changed) return subtask;
    changed = true;
    return { ...subtask, children: childResult.subtasks };
  });

  return { subtasks: nextSubtasks, changed };
}

function areAllSubtasksCompleted(subtasks: readonly TodoSubtask[] = []): boolean {
  if (subtasks.length === 0) return false;

  return subtasks.every(
    (subtask) =>
      subtask.completed && subtask.children.every((child) => child.completed),
  );
}

function completeTodoAfterSubtasks(todo: Todo, now: number): Todo {
  if (todo.completed || !areAllSubtasksCompleted(todo.subtasks)) return todo;
  return toggleTodoCompletion(todo, now);
}

function uncompleteTodoAfterSubtasks(todo: Todo, now: number): Todo {
  if (!todo.completed || areAllSubtasksCompleted(todo.subtasks)) return todo;

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

export function addTodoSubtask(
  todos: Todo[],
  todoId: string,
  parentSubtaskId: string | null,
  details: SubtaskDetails,
  now: number,
): Todo[] {
  const trimmedTitle = details.title.trim();
  if (!trimmedTitle) return todos;

  const subtask: TodoSubtask = {
    id: createSubtaskId(now),
    title: trimmedTitle,
    urgency: details.urgency,
    plannedSeconds: details.countdownEnabled
      ? Math.max(60, details.plannedSeconds)
      : 0,
    countdownEnabled: details.countdownEnabled,
    recordTimeEnabled: details.recordTimeEnabled,
    completed: false,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    createdAt: now,
    completedAt: null,
    children: [],
  };

  return todos.map((todo) => {
    if (todo.id !== todoId) return todo;
    if (parentSubtaskId == null) {
      return { ...todo, subtasks: [...(todo.subtasks ?? []), subtask] };
    }

    return {
      ...todo,
      subtasks: updateSubtasks(todo.subtasks, (current, depth) => {
        if (current.id !== parentSubtaskId) return current;
        if (depth === 2) return current;
        return { ...current, children: [...current.children, subtask] };
      }),
    };
  });
}

export function renameTodoSubtask(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  title: string,
): Todo[] {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return todos;

  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          subtasks: updateSubtasks(todo.subtasks, (subtask) =>
            subtask.id === subtaskId
              ? { ...subtask, title: trimmedTitle }
              : subtask,
          ),
        }
      : todo,
  );
}

export function updateTodoSubtaskDetails(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  details: SubtaskDetails,
): Todo[] {
  const trimmedTitle = details.title.trim();
  if (!trimmedTitle) return todos;

  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          subtasks: updateSubtasks(todo.subtasks, (subtask) => {
            if (subtask.id !== subtaskId) return subtask;
            const keepTimingState = details.recordTimeEnabled || !subtask.isTiming;
            return {
              ...subtask,
              title: trimmedTitle,
              urgency: details.urgency,
              countdownEnabled: details.countdownEnabled,
              plannedSeconds: details.countdownEnabled
                ? Math.max(60, details.plannedSeconds)
                : 0,
              recordTimeEnabled: details.recordTimeEnabled,
              isTiming: keepTimingState ? subtask.isTiming : false,
              timingStartedAt: keepTimingState ? subtask.timingStartedAt : null,
            };
          }),
        }
      : todo,
  );
}

export function updateTodoComment(
  todos: Todo[],
  id: string,
  comment: string,
): Todo[] {
  const nextComment = comment.trim();
  return todos.map((todo) =>
    todo.id === id ? { ...todo, comment: nextComment } : todo,
  );
}

export function toggleTodoFavorite(todos: Todo[], id: string): Todo[] {
  return todos.map((todo) =>
    todo.id === id ? { ...todo, favorite: !todo.favorite } : todo,
  );
}

export function clearTodoFavorites(todos: Todo[]): Todo[] {
  return todos.map((todo) => (todo.favorite ? { ...todo, favorite: false } : todo));
}

export function removeTodos(todos: Todo[], ids: Iterable<string>): Todo[] {
  const idSet = new Set(ids);
  if (idSet.size === 0) return todos;
  return todos.filter((todo) => !idSet.has(todo.id));
}

export function clearSelectedTodoFavorites(
  todos: Todo[],
  ids: Iterable<string>,
): Todo[] {
  const idSet = new Set(ids);
  if (idSet.size === 0) return todos;
  return todos.map((todo) =>
    idSet.has(todo.id) && todo.favorite ? { ...todo, favorite: false } : todo,
  );
}

export function moveTodosToDate(
  todos: Todo[],
  ids: Iterable<string>,
  targetDate: string,
): Todo[] {
  const idSet = new Set(ids);
  if (idSet.size === 0 || !targetDate) return todos;

  const movingTodos = todos.filter((todo) => idSet.has(todo.id));
  if (movingTodos.length === 0) return todos;

  const targetSortOrders = todos
    .filter((todo) => !idSet.has(todo.id) && todo.date === targetDate)
    .map((todo) => todo.sortOrder);
  const targetMinSortOrder = Math.min(...targetSortOrders);
  const startSortOrder = Number.isFinite(targetMinSortOrder)
    ? targetMinSortOrder - movingTodos.length * 1000
    : 1000;
  const nextSortOrderById = new Map(
    [...movingTodos]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
      .map((todo, index) => [todo.id, startSortOrder + index * 1000]),
  );

  return todos.map((todo) => {
    const nextSortOrder = nextSortOrderById.get(todo.id);
    if (nextSortOrder == null) return todo;
    const taskTime = getDateTimeTimestamp(targetDate, formatTodoTime(todo));
    return {
      ...todo,
      date: targetDate,
      createdAt: taskTime,
      sortOrder: nextSortOrder,
    };
  });
}

function formatTodoTime(todo: Todo): string {
  const date = new Date(todo.createdAt);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function syncTodoSubtaskElapsedFromParent(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  now: number,
): Todo[] {
  return todos.map((todo) => {
    if (todo.id !== todoId || !todo.countdownEnabled || todo.plannedSeconds <= 0) {
      return todo;
    }

    const parentElapsedSeconds =
      todo.isTiming && todo.timingStartedAt != null
        ? todo.elapsedSeconds + Math.floor((now - todo.timingStartedAt) / 1000)
        : todo.elapsedSeconds;

    return {
      ...todo,
      subtasks: updateSubtasks(todo.subtasks, (subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              elapsedSeconds: Math.max(0, parentElapsedSeconds),
              timingStartedAt: subtask.isTiming ? now : subtask.timingStartedAt,
            }
          : subtask,
      ),
    };
  });
}

export function toggleTodoSubtask(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  now: number,
): Todo[] {
  return todos.map((todo) => {
    if (todo.id !== todoId) return todo;

    const updatedTodo = {
      ...todo,
      subtasks: updateSubtasks(todo.subtasks, (subtask) =>
        subtask.id === subtaskId
          ? toggleSubtaskCompletion(subtask, now)
          : subtask,
      ),
    };

    return completeTodoAfterSubtasks(
      uncompleteTodoAfterSubtasks(updatedTodo, now),
      now,
    );
  });
}

export function startTodoSubtaskTiming(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  now: number,
): Todo[] {
  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          subtasks: updateSubtasks(todo.subtasks, (subtask) =>
            subtask.id === subtaskId &&
            !subtask.completed &&
            !subtask.isTiming &&
            subtask.recordTimeEnabled
              ? startSubtaskTiming(subtask, now)
              : subtask,
          ),
        }
      : todo,
  );
}

export function pauseTodoSubtaskTiming(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  now: number,
): Todo[] {
  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          subtasks: updateSubtasks(todo.subtasks, (subtask) =>
            subtask.id === subtaskId ? settleSubtaskTiming(subtask, now) : subtask,
          ),
        }
      : todo,
  );
}

export function stopTodoSubtaskTiming(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
  now: number,
): Todo[] {
  return todos.map((todo) => {
    if (todo.id !== todoId) return todo;

    const updatedTodo = {
      ...todo,
      subtasks: updateSubtasks(todo.subtasks, (subtask) => {
        if (subtask.id !== subtaskId) return subtask;
        const settled = settleSubtaskTiming(subtask, now);
        return {
          ...settled,
          completed: true,
          completedAt: now,
          actualDurationSeconds: settled.elapsedSeconds,
        };
      }),
    };

    return completeTodoAfterSubtasks(updatedTodo, now);
  });
}

export function removeTodoSubtask(
  todos: Todo[],
  todoId: string,
  subtaskId: string,
): Todo[] {
  return todos.map((todo) =>
    todo.id === todoId
      ? {
          ...todo,
          subtasks: updateSubtasks(todo.subtasks, (subtask) =>
            subtask.id === subtaskId ? null : subtask,
          ),
        }
      : todo,
  );
}

export function reorderTodoSubtask(
  todos: Todo[],
  todoId: string,
  draggedSubtaskId: string,
  targetSubtaskId: string,
): Todo[] {
  if (draggedSubtaskId === targetSubtaskId) return todos;

  return todos.map((todo) => {
    if (todo.id !== todoId) return todo;
    const result = reorderSubtasksInSiblings(
      todo.subtasks,
      draggedSubtaskId,
      targetSubtaskId,
    );
    return result.changed ? { ...todo, subtasks: result.subtasks } : todo;
  });
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

    const keepTimeData = updates.countdownEnabled || updates.recordTimeEnabled;
    const keepTimingState = keepTimeData || !todo.isTiming;
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
      createdAt:
        updates.taskTime == null
          ? todo.createdAt
          : getDateTimeTimestamp(updates.date, updates.taskTime),
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
      elapsedSeconds: keepTimeData ? todo.elapsedSeconds : 0,
      actualDurationSeconds: keepTimeData ? todo.actualDurationSeconds : null,
      recurrenceSeriesId: nextSeriesId,
      recurrence: occurrenceRecurrence,
      recurrenceTemplate: nextTemplate,
      images: updates.images ?? todo.images,
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
    subtasks: updateSubtasks(current.subtasks, (subtask) =>
      completeSubtask(subtask, now),
    ),
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
    return {
      ...todo,
      isTiming: true,
      timingStartedAt: now,
      subtasks: updateSubtasks(todo.subtasks, (subtask) =>
        startSubtaskTiming(subtask, now),
      ),
    };
  });
}

export function pauseTodoTiming(
  todos: Todo[],
  id: string,
  now: number,
): Todo[] {
  return todos.map((todo) => {
    if (todo.id !== id || !todo.isTiming || todo.timingStartedAt == null) {
      return todo;
    }

    const extra = Math.floor((now - todo.timingStartedAt) / 1000);
    return {
      ...todo,
      isTiming: false,
      timingStartedAt: null,
      elapsedSeconds: todo.elapsedSeconds + extra,
      subtasks: updateSubtasks(todo.subtasks, (subtask) =>
        settleSubtaskTiming(subtask, now),
      ),
    };
  });
}

function resetTodoSubtaskTimingState(subtask: TodoSubtask): TodoSubtask {
  return {
    ...subtask,
    completed: false,
    completedAt: null,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    children: subtask.children.map(resetTodoSubtaskTimingState),
  };
}

function resetTodoTimingState(todo: Todo): Todo {
  return {
    ...todo,
    completed: false,
    completedAt: null,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    subtasks: (todo.subtasks ?? []).map(resetTodoSubtaskTimingState),
  };
}

export function resetTodoTiming(todos: Todo[], id: string): Todo[] {
  return todos.map((todo) => (todo.id === id ? resetTodoTimingState(todo) : todo));
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
      subtasks: updateSubtasks(todo.subtasks, (subtask) =>
        uncompleteSubtask(subtask, now),
      ),
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
    subtasks: updateSubtasks(todo.subtasks, (subtask) =>
      completeSubtask(subtask, now),
    ),
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
