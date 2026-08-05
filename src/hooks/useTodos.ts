import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Todo, TodoDateSummary, TodoSubtask, Urgency } from "../types";
import type { RecurrenceRule } from "../types";
import {
  APP_DATA_STORAGE_KEY,
  createAppDataDocument,
  exportAppDataAsText,
  loadAppData,
  parseImportedAppData,
  saveAppData,
  type ImportAppDataResult,
  type LoadAppDataResult,
} from "../data/appData";
import {
  applyReminderAction,
  applyReminderFired,
  addTodoSubtask,
  clearTodoFavorites,
  pauseTodoTiming,
  pauseTodoSubtaskTiming,
  removeTodoSubtask,
  renameTodoSubtask,
  reorderTodoSubtask,
  resetTodoTiming,
  startTodoSubtaskTiming,
  startTodoTiming,
  stopTodoSubtaskTiming,
  stopTodoTimingWithRecurrence,
  syncTodoSubtaskElapsedFromParent,
  toggleTodoSubtask,
  toggleTodoCompletionWithRecurrence,
  toggleTodoFavorite,
  updateTodoComment,
  updateTodoDetails,
  updateTodoSubtaskDetails,
  type SubtaskDetails,
  type TodoDetailsUpdate,
} from "../domain/todoState";
import {
  createRecurrenceTemplate,
  normalizeRecurrenceRule,
} from "../domain/recurrence";
import {
  REMINDER_ACTION_EVENT,
  REMINDER_FIRED_EVENT,
  type ActiveReminderGroup,
  createReminderItem,
  getDefaultReminderTime,
  getReminderDueAt,
  isTodoReminderDue,
  mergeActiveReminderItems,
  normalizeReminderTime,
  parseReminderActionPayload,
  parseReminderFiredPayload,
  readActiveReminderGroup,
  saveActiveReminderGroup,
} from "../utils/reminders";

const REMINDER_RETRY_DELAY_MS = 30 * 1000;
const MAX_REMINDER_TIMER_DELAY_MS = 60 * 1000;

type ScheduledReminder = {
  id: string;
  title: string;
  reminderTime: string;
  dueAt: number;
};

async function showDesktopReminder(group: ActiveReminderGroup) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_reminder_window", {
    reminderGroup: JSON.stringify(group),
  });
}

async function scheduleNativeReminders(reminders: ScheduledReminder[]) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("schedule_reminders", { reminders });
}

function getNextPendingReminderAt(todos: Todo[]) {
  return todos.reduce<number | null>((nextAt, todo) => {
    const dueAt = getReminderDueAt(todo);
    if (dueAt == null) return nextAt;
    if (todo.reminderLastFiredAt != null && todo.reminderLastFiredAt >= dueAt) {
      return nextAt;
    }
    return nextAt == null ? dueAt : Math.min(nextAt, dueAt);
  }, null);
}

function getPendingScheduledReminders(todos: Todo[]): ScheduledReminder[] {
  return todos
    .map((todo) => {
      const dueAt = getReminderDueAt(todo);
      if (dueAt == null) return null;
      if (todo.reminderLastFiredAt != null && todo.reminderLastFiredAt >= dueAt) {
        return null;
      }
      const item = createReminderItem(todo);
      return item;
    })
    .filter((item): item is ScheduledReminder => item != null);
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hasTimingSubtask(todo: Todo): boolean {
  const visit = (subtasks: readonly TodoSubtask[]): boolean =>
    subtasks.some((subtask) => subtask.isTiming || visit(subtask.children));
  return visit(todo.subtasks ?? []);
}

export function useTodos(selectedDate: string) {
  const initialDataRef = useRef<LoadAppDataResult | null>(null);
  if (initialDataRef.current == null) {
    initialDataRef.current = loadAppData(localStorage);
  }
  const initialData = initialDataRef.current;
  const [todos, setTodos] = useState<Todo[]>(initialData.data.todos);
  const [manualSortDates, setManualSortDates] = useState<Set<string>>(
    () => new Set(initialData.data.manualSortDates),
  );
  const [storageNotice, setStorageNotice] = useState<string | null>(
    initialData.notice,
  );
  const [tick, setTick] = useState(0);
  const [reminderRetryToken, setReminderRetryToken] = useState(0);
  const [nativeReminderSchedulerAvailable, setNativeReminderSchedulerAvailable] =
    useState<boolean | null>(null);
  const reminderScanInFlightRef = useRef(false);
  const reminderLastFailedAtRef = useRef(0);

  useEffect(() => {
    const result = saveAppData(
      createAppDataDocument(todos, manualSortDates),
      localStorage,
    );
    if (!result.ok) setStorageNotice(`保存失败：${result.error}`);
  }, [manualSortDates, todos]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_DATA_STORAGE_KEY) return;
      const loaded = loadAppData(localStorage);
      setTodos(loaded.data.todos);
      setManualSortDates(new Set(loaded.data.manualSortDates));
      if (loaded.notice) setStorageNotice(loaded.notice);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void)[] = [];

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) =>
        Promise.all([
          listen(REMINDER_ACTION_EVENT, (event) => {
            const action = parseReminderActionPayload(event.payload);
            if (action == null) return;
            setTodos((current) => applyReminderAction(current, action));
          }),
          listen(REMINDER_FIRED_EVENT, (event) => {
            const fired = parseReminderFiredPayload(event.payload);
            if (fired == null) return;
            setTodos((current) => applyReminderFired(current, fired));
          }),
        ]),
      )
      .then((unlistenCallbacks) => {
        if (disposed) {
          unlistenCallbacks.forEach((unlisten) => unlisten());
          return;
        }
        cleanup = unlistenCallbacks;
      })
      .catch(() => {
        cleanup = [];
      });

    return () => {
      disposed = true;
      cleanup.forEach((unlisten) => unlisten());
    };
  }, []);

  // 计时中每秒刷新 UI
  useEffect(() => {
    const hasTiming = todos.some((t) => t.isTiming || hasTimingSubtask(t));
    if (!hasTiming) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [todos]);

  useEffect(() => {
    let disposed = false;
    const scheduledReminders = getPendingScheduledReminders(todos);

    void scheduleNativeReminders(scheduledReminders)
      .then(() => {
        if (!disposed) setNativeReminderSchedulerAvailable(true);
      })
      .catch((error) => {
        if (!disposed) setNativeReminderSchedulerAvailable(false);
        console.error("Failed to schedule native reminders", error);
      });

    return () => {
      disposed = true;
    };
  }, [todos]);

  const scanReminders = useCallback(() => {
    const now = Date.now();
    if (reminderScanInFlightRef.current) return;
    if (now - reminderLastFailedAtRef.current < REMINDER_RETRY_DELAY_MS) {
      return;
    }

    const dueTodos = todos.filter((todo) => isTodoReminderDue(todo, now));
    if (dueTodos.length === 0) return;

    const activeItems = dueTodos
      .map((todo) => createReminderItem(todo))
      .filter((item): item is NonNullable<typeof item> => item != null);

    if (activeItems.length === 0) return;

    const reminderGroup: ActiveReminderGroup = mergeActiveReminderItems(
      readActiveReminderGroup(),
      activeItems,
      now,
    );

    reminderScanInFlightRef.current = true;
    void (async () => {
      try {
        saveActiveReminderGroup(reminderGroup);
        await showDesktopReminder(reminderGroup);
        setTodos((prev) =>
          prev.map((todo) =>
            dueTodos.some((item) => item.id === todo.id)
              ? {
                  ...todo,
                  reminderLastFiredAt: now,
                  reminderSnoozedUntil:
                    todo.reminderSnoozedUntil != null &&
                    todo.reminderSnoozedUntil <= now
                      ? null
                      : todo.reminderSnoozedUntil,
                }
              : todo,
          ),
        );
      } catch (error) {
        reminderLastFailedAtRef.current = Date.now();
        setReminderRetryToken((token) => token + 1);
        console.error("Failed to show desktop reminder window", error);
      } finally {
        reminderScanInFlightRef.current = false;
      }
    })();
  }, [todos]);

  useEffect(() => {
    if (nativeReminderSchedulerAvailable !== false) return;

    const nextReminderAt = getNextPendingReminderAt(todos);
    if (nextReminderAt == null) return;

    const now = Date.now();
    const retryDelay = reminderLastFailedAtRef.current
      ? Math.max(
          0,
          REMINDER_RETRY_DELAY_MS - (now - reminderLastFailedAtRef.current),
        )
      : 0;
    const reminderDelay = Math.max(0, nextReminderAt - now);
    const delay = Math.min(
      Math.max(retryDelay, reminderDelay),
      MAX_REMINDER_TIMER_DELAY_MS,
    );

    const id = window.setTimeout(scanReminders, delay);
    return () => window.clearTimeout(id);
  }, [nativeReminderSchedulerAvailable, reminderRetryToken, scanReminders, todos]);

  const dayTodos = useMemo(() => {
    void tick; // 依赖 tick 以刷新进行中的计时显示
    const isManualSort = manualSortDates.has(selectedDate);
    return todos
      .filter((t) => t.date === selectedDate)
      .sort((a, b) => {
        if (!isManualSort && a.completed !== b.completed) {
          return a.completed ? 1 : -1;
        }

        return a.sortOrder - b.sortOrder;
      });
  }, [manualSortDates, todos, selectedDate, tick]);

  const stats = useMemo(() => {
    const list = dayTodos;
    const total = list.length;
    const done = list.filter((t) => t.completed).length;
    const timing = list.filter((t) => t.isTiming).length;
    const totalActual = list
      .filter((t) => t.actualDurationSeconds != null)
      .reduce((sum, t) => sum + (t.actualDurationSeconds ?? 0), 0);
    return { total, done, timing, totalActual };
  }, [dayTodos]);

  const todoDateSummaries = useMemo(() => {
    const summaries = new Map<string, TodoDateSummary>();
    for (const todo of todos) {
      const summary = summaries.get(todo.date) ?? { total: 0, pending: 0 };
      summary.total += 1;
      if (!todo.completed) summary.pending += 1;
      summaries.set(todo.date, summary);
    }
    return summaries;
  }, [todos]);

  const addTodo = useCallback(
    (
      title: string,
      urgency: Urgency,
      plannedSeconds: number,
      countdownEnabled: boolean,
      reminderEnabled: boolean,
      reminderTime: string | null,
      recordTimeEnabled: boolean,
      taskTime: string,
      date?: string,
      recurrence?: RecurrenceRule | null,
    ) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const todoDate = date ?? selectedDate;
      setTodos((prev) => {
        const minSortOrder = Math.min(
          ...prev
            .filter((item) => item.date === todoDate)
            .map((item) => item.sortOrder),
        );
        const now = Date.now();
        const [hour = "0", minute = "0"] = taskTime.split(":");
        const createdDate = new Date(`${todoDate}T00:00:00`);
        createdDate.setHours(Number(hour), Number(minute), 0, 0);
        const createdAt = createdDate.getTime();
        const normalizedRecurrence = normalizeRecurrenceRule(
          recurrence ?? null,
          todoDate,
        );
        const todo: Todo = {
          id: createId(),
          title: trimmed,
          urgency,
          date: todoDate,
          sortOrder: Number.isFinite(minSortOrder) ? minSortOrder - 1000 : 1000,
          plannedSeconds: countdownEnabled ? Math.max(60, plannedSeconds) : 0,
          countdownEnabled,
          reminderEnabled,
          reminderTime: reminderEnabled
            ? normalizeReminderTime(reminderTime) ?? getDefaultReminderTime()
            : null,
          recordTimeEnabled,
          reminderSnoozedUntil: null,
          reminderLastFiredAt: null,
          completed: false,
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: 0,
          actualDurationSeconds: null,
          comment: "",
          favorite: false,
          createdAt,
          completedAt: null,
          recurrenceSeriesId:
            normalizedRecurrence == null
              ? null
              : `series-${now}-${Math.random().toString(36).slice(2, 9)}`,
          recurrence: normalizedRecurrence,
          recurrenceTemplate: null,
          subtasks: [],
        };
        todo.recurrenceTemplate =
          normalizedRecurrence == null ? null : createRecurrenceTemplate(todo);

        return [todo, ...prev];
      });
    },
    [selectedDate],
  );

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearDayTodos = useCallback(() => {
    setTodos((prev) => prev.filter((todo) => todo.date !== selectedDate));
    setManualSortDates((prev) => {
      if (!prev.has(selectedDate)) return prev;
      const next = new Set(prev);
      next.delete(selectedDate);
      return next;
    });
  }, [selectedDate]);

  const reorderTodo = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;

      setTodos((prev) => {
        const isManualSort = manualSortDates.has(selectedDate);
        const orderedDayTodos = prev
          .filter((todo) => todo.date === selectedDate)
          .sort((a, b) => {
            if (!isManualSort && a.completed !== b.completed) {
              return a.completed ? 1 : -1;
            }

            return a.sortOrder - b.sortOrder;
          });
        const draggedIndex = orderedDayTodos.findIndex(
          (todo) => todo.id === draggedId,
        );
        const targetIndex = orderedDayTodos.findIndex(
          (todo) => todo.id === targetId,
        );

        if (draggedIndex < 0 || targetIndex < 0) return prev;

        const reordered = [...orderedDayTodos];
        const [draggedTodo] = reordered.splice(draggedIndex, 1);
        reordered.splice(targetIndex, 0, draggedTodo);

        const sortOrderById = new Map(
          reordered.map((todo, index) => [todo.id, (index + 1) * 1000]),
        );

        return prev.map((todo) => {
          const sortOrder = sortOrderById.get(todo.id);
          return sortOrder == null ? todo : { ...todo, sortOrder };
        });
      });

      setManualSortDates((prev) => {
        if (prev.has(selectedDate)) return prev;
        const next = new Set(prev);
        next.add(selectedDate);
        return next;
      });
    },
    [manualSortDates, selectedDate],
  );

  const toggleComplete = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) => toggleTodoCompletionWithRecurrence(prev, id, now));
  }, []);

  const updateTodo = useCallback(
    (id: string, updates: TodoDetailsUpdate) => {
      setTodos((prev) => updateTodoDetails(prev, id, updates));
    },
    [],
  );

  const updateComment = useCallback((id: string, comment: string) => {
    setTodos((prev) => updateTodoComment(prev, id, comment));
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setTodos((prev) => toggleTodoFavorite(prev, id));
  }, []);

  const clearFavorites = useCallback(() => {
    setTodos((prev) => clearTodoFavorites(prev));
  }, []);

  const addSubtask = useCallback(
    (
      todoId: string,
      parentSubtaskId: string | null,
      details: SubtaskDetails,
    ) => {
      const now = Date.now();
      setTodos((prev) =>
        addTodoSubtask(prev, todoId, parentSubtaskId, details, now),
      );
    },
    [],
  );

  const renameSubtask = useCallback(
    (todoId: string, subtaskId: string, title: string) => {
      setTodos((prev) => renameTodoSubtask(prev, todoId, subtaskId, title));
    },
    [],
  );

  const updateSubtask = useCallback(
    (todoId: string, subtaskId: string, details: SubtaskDetails) => {
      setTodos((prev) =>
        updateTodoSubtaskDetails(prev, todoId, subtaskId, details),
      );
    },
    [],
  );

  const syncSubtaskElapsedFromParent = useCallback(
    (todoId: string, subtaskId: string) => {
      const now = Date.now();
      setTodos((prev) =>
        syncTodoSubtaskElapsedFromParent(prev, todoId, subtaskId, now),
      );
    },
    [],
  );

  const toggleSubtask = useCallback((todoId: string, subtaskId: string) => {
    const now = Date.now();
    setTodos((prev) => toggleTodoSubtask(prev, todoId, subtaskId, now));
  }, []);

  const removeSubtask = useCallback((todoId: string, subtaskId: string) => {
    setTodos((prev) => removeTodoSubtask(prev, todoId, subtaskId));
  }, []);

  const reorderSubtask = useCallback(
    (todoId: string, draggedSubtaskId: string, targetSubtaskId: string) => {
      setTodos((prev) =>
        reorderTodoSubtask(prev, todoId, draggedSubtaskId, targetSubtaskId),
      );
    },
    [],
  );

  const startSubtaskTiming = useCallback((todoId: string, subtaskId: string) => {
    const now = Date.now();
    setTodos((prev) => startTodoSubtaskTiming(prev, todoId, subtaskId, now));
  }, []);

  const pauseSubtaskTiming = useCallback((todoId: string, subtaskId: string) => {
    const now = Date.now();
    setTodos((prev) => pauseTodoSubtaskTiming(prev, todoId, subtaskId, now));
  }, []);

  const stopSubtaskTiming = useCallback((todoId: string, subtaskId: string) => {
    const now = Date.now();
    setTodos((prev) => stopTodoSubtaskTiming(prev, todoId, subtaskId, now));
  }, []);

  const startTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) => startTodoTiming(prev, id, now));
  }, []);

  const pauseTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) => pauseTodoTiming(prev, id, now));
  }, []);

  const stopTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) => stopTodoTimingWithRecurrence(prev, id, now));
  }, []);

  const resetTiming = useCallback((id: string) => {
    setTodos((prev) => resetTodoTiming(prev, id));
  }, []);

  /** 获取实时已用秒数（含进行中片段） */
  const getLiveElapsed = useCallback(
    (todo: Todo): number => {
      void tick;
      if (todo.isTiming && todo.timingStartedAt) {
        return (
          todo.elapsedSeconds +
          Math.floor((Date.now() - todo.timingStartedAt) / 1000)
        );
      }
      return todo.elapsedSeconds;
    },
    [tick],
  );

  /** 倒计时剩余秒数（计划 - 已用） */
  const getCountdownRemaining = useCallback(
    (todo: Todo): number => {
      if (!todo.countdownEnabled) return 0;
      return Math.max(0, todo.plannedSeconds - getLiveElapsed(todo));
    },
    [getLiveElapsed],
  );

  const exportTodosData = useCallback(
    () =>
      exportAppDataAsText(createAppDataDocument(todos, manualSortDates)),
    [manualSortDates, todos],
  );

  const exportSelectedDateData = useCallback(
    () =>
      exportAppDataAsText(
        createAppDataDocument(todos, manualSortDates),
        selectedDate,
      ),
    [manualSortDates, selectedDate, todos],
  );

  const importTodosData = useCallback(
    (text: string): ImportAppDataResult => {
      const result = parseImportedAppData(text);
      if (!result.ok) return result;

      setTodos(result.data.todos);
      setManualSortDates(new Set(result.data.manualSortDates));
      setStorageNotice(`已导入 ${result.data.todos.length} 个待办。`);
      return result;
    },
    [],
  );

  return {
    allTodos: todos,
    dayTodos,
    stats,
    todoDateSummaries,
    addTodo,
    removeTodo,
    clearDayTodos,
    reorderTodo,
    toggleComplete,
    updateTodo,
    updateComment,
    toggleFavorite,
    clearFavorites,
    addSubtask,
    renameSubtask,
    updateSubtask,
    syncSubtaskElapsedFromParent,
    toggleSubtask,
    removeSubtask,
    reorderSubtask,
    startSubtaskTiming,
    pauseSubtaskTiming,
    stopSubtaskTiming,
    startTiming,
    pauseTiming,
    stopTiming,
    resetTiming,
    getLiveElapsed,
    getCountdownRemaining,
    exportTodosData,
    exportSelectedDateData,
    importTodosData,
    storageNotice,
  };
}
