import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Todo, Urgency } from "../types";
import { URGENCY_ORDER } from "../types";
import { formatDateKey } from "../utils/time";
import {
  TODO_STORAGE_KEY,
  type ActiveReminderGroup,
  createReminderItem,
  getDefaultReminderTime,
  getReminderDueAt,
  isTodoReminderDue,
  mergeActiveReminderItems,
  normalizeReminderTime,
  readActiveReminderGroup,
  saveActiveReminderGroup,
} from "../utils/reminders";

const MANUAL_SORT_DATES_STORAGE_KEY = "dotime-manual-sort-dates-v1";
const REMINDER_RETRY_DELAY_MS = 30 * 1000;
const MAX_REMINDER_TIMER_DELAY_MS = 60 * 1000;
const REMINDER_UPDATED_EVENT = "dotime-reminder-updated";

type ScheduledReminder = {
  id: string;
  title: string;
  reminderTime: string;
  dueAt: number;
};

type StoredTodo = Omit<
  Todo,
  | "sortOrder"
  | "reminderEnabled"
  | "reminderTime"
  | "recordTimeEnabled"
  | "reminderSnoozedUntil"
  | "reminderLastFiredAt"
> & {
  sortOrder?: number;
  reminderEnabled?: boolean;
  reminderTime?: string | null;
  recordTimeEnabled?: boolean;
  reminderSnoozedUntil?: number | null;
  reminderLastFiredAt?: number | null;
};

function getInitialOrderRank(todo: Todo) {
  if (todo.isTiming) return 0;
  if (!todo.completed) return 1;
  return 2;
}

function compareInitialOrder(a: Todo, b: Todo) {
  const rankDiff = getInitialOrderRank(a) - getInitialOrderRank(b);
  if (rankDiff !== 0) return rankDiff;

  const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
  if (urgencyDiff !== 0) return urgencyDiff;

  return b.createdAt - a.createdAt;
}

function withMigratedSortOrder(todos: Todo[]): Todo[] {
  const todosByDate = new Map<string, Todo[]>();

  todos.forEach((todo) => {
    const dateTodos = todosByDate.get(todo.date) ?? [];
    dateTodos.push(todo);
    todosByDate.set(todo.date, dateTodos);
  });

  const sortOrderById = new Map<string, number>();

  todosByDate.forEach((dateTodos) => {
    const needsMigration = dateTodos.some(
      (todo) => !Number.isFinite(todo.sortOrder),
    );
    const ordered = needsMigration
      ? [...dateTodos].sort(compareInitialOrder)
      : [...dateTodos].sort((a, b) => a.sortOrder - b.sortOrder);

    ordered.forEach((todo, index) => {
      sortOrderById.set(todo.id, (index + 1) * 1000);
    });
  });

  return todos.map((todo) => ({
    ...todo,
    sortOrder: sortOrderById.get(todo.id) ?? todo.sortOrder,
  }));
}

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(TODO_STORAGE_KEY);
    if (!raw) return [];
    const savedTodos = JSON.parse(raw) as StoredTodo[];
    return withMigratedSortOrder(
      savedTodos.map((todo) => ({
        ...todo,
        sortOrder:
          typeof todo.sortOrder === "number" ? todo.sortOrder : Number.NaN,
        countdownEnabled:
          todo.countdownEnabled ?? (Number(todo.plannedSeconds) > 0),
        plannedSeconds:
          Number(todo.plannedSeconds) > 0 ? todo.plannedSeconds : 0,
        reminderEnabled: Boolean(todo.reminderEnabled),
        reminderTime: normalizeReminderTime(todo.reminderTime),
        recordTimeEnabled: todo.recordTimeEnabled ?? true,
        reminderSnoozedUntil:
          typeof todo.reminderSnoozedUntil === "number"
            ? todo.reminderSnoozedUntil
            : null,
        reminderLastFiredAt:
          typeof todo.reminderLastFiredAt === "number"
            ? todo.reminderLastFiredAt
            : null,
      })),
    );
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]) {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
}

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

function loadManualSortDates(): Set<string> {
  try {
    const raw = localStorage.getItem(MANUAL_SORT_DATES_STORAGE_KEY);
    if (!raw) return new Set();
    const dates = JSON.parse(raw) as unknown;
    if (!Array.isArray(dates)) return new Set();
    return new Set(
      dates.filter((date): date is string => typeof date === "string"),
    );
  } catch {
    return new Set();
  }
}

function saveManualSortDates(dates: Set<string>) {
  localStorage.setItem(
    MANUAL_SORT_DATES_STORAGE_KEY,
    JSON.stringify([...dates]),
  );
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useTodos(selectedDate: string) {
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  const [manualSortDates, setManualSortDates] = useState<Set<string>>(() =>
    loadManualSortDates(),
  );
  const [tick, setTick] = useState(0);
  const [reminderRetryToken, setReminderRetryToken] = useState(0);
  const [nativeReminderSchedulerAvailable, setNativeReminderSchedulerAvailable] =
    useState<boolean | null>(null);
  const reminderScanInFlightRef = useRef(false);
  const reminderLastFailedAtRef = useRef(0);

  // 持久化
  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  useEffect(() => {
    saveManualSortDates(manualSortDates);
  }, [manualSortDates]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TODO_STORAGE_KEY) return;
      setTodos(loadTodos());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen(REMINDER_UPDATED_EVENT, () => {
          setTodos(loadTodos());
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => {
        cleanup = undefined;
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // 计时中每秒刷新 UI
  useEffect(() => {
    const hasTiming = todos.some((t) => t.isTiming);
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

  const addTodo = useCallback(
    (
      title: string,
      urgency: Urgency,
      plannedSeconds: number,
      countdownEnabled: boolean,
      reminderEnabled: boolean,
      reminderTime: string | null,
      recordTimeEnabled: boolean,
      date?: string,
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
          createdAt: Date.now(),
          completedAt: null,
        };

        return [todo, ...prev];
      });
    },
    [selectedDate],
  );

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.completed) {
          const elapsed = Math.max(
            t.elapsedSeconds,
            t.actualDurationSeconds ?? 0,
          );
          return {
            ...t,
            completed: false,
            completedAt: null,
            isTiming: elapsed > 0,
            timingStartedAt: elapsed > 0 ? now : null,
            elapsedSeconds: elapsed,
            actualDurationSeconds: null,
          };
        }
        // 完成时若仍在计时，先结算
        let elapsed = t.elapsedSeconds;
        if (t.isTiming && t.timingStartedAt) {
          elapsed += Math.floor((now - t.timingStartedAt) / 1000);
        }
        return {
          ...t,
          completed: true,
          completedAt: now,
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: elapsed,
          actualDurationSeconds: elapsed > 0 ? elapsed : t.actualDurationSeconds,
        };
      }),
    );
  }, []);

  const updateTodo = useCallback(
    (
      id: string,
      updates: {
        title: string;
        urgency: Urgency;
        plannedSeconds: number;
        countdownEnabled: boolean;
        reminderEnabled: boolean;
        reminderTime: string | null;
        recordTimeEnabled: boolean;
      },
    ) => {
      const trimmed = updates.title.trim();
      if (!trimmed) return;
      setTodos((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;

          const keepTimingState = updates.recordTimeEnabled || !t.isTiming;
          const nextReminderTime = updates.reminderEnabled
            ? normalizeReminderTime(updates.reminderTime) ?? getDefaultReminderTime()
            : null;
          const reminderChanged =
            t.reminderEnabled !== updates.reminderEnabled ||
            t.reminderTime !== nextReminderTime;

          return {
            ...t,
            title: trimmed,
            urgency: updates.urgency,
            countdownEnabled: updates.countdownEnabled,
            plannedSeconds: updates.countdownEnabled
              ? Math.max(60, updates.plannedSeconds)
              : 0,
            reminderEnabled: updates.reminderEnabled,
            reminderTime: nextReminderTime,
            recordTimeEnabled: updates.recordTimeEnabled,
            reminderSnoozedUntil: updates.reminderEnabled && !reminderChanged
              ? t.reminderSnoozedUntil
              : null,
            reminderLastFiredAt: updates.reminderEnabled && !reminderChanged
              ? t.reminderLastFiredAt
              : null,
            isTiming: keepTimingState ? t.isTiming : false,
            timingStartedAt: keepTimingState ? t.timingStartedAt : null,
          };
        }),
      );
    },
    [],
  );

  const startTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          if (t.completed || t.isTiming || !t.recordTimeEnabled) return t;
          return { ...t, isTiming: true, timingStartedAt: now };
        }
        return t;
      }),
    );
  }, []);

  const pauseTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id || !t.isTiming || !t.timingStartedAt) return t;
        const extra = Math.floor((now - t.timingStartedAt) / 1000);
        return {
          ...t,
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: t.elapsedSeconds + extra,
        };
      }),
    );
  }, []);

  const stopTiming = useCallback((id: string) => {
    const now = Date.now();
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id || !t.isTiming || !t.timingStartedAt) return t;
        const extra = Math.floor((now - t.timingStartedAt) / 1000);
        const total = t.elapsedSeconds + extra;
        return {
          ...t,
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: total,
          actualDurationSeconds: total,
          completed: true,
          completedAt: now,
        };
      }),
    );
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

  const shiftDate = useCallback((dateKey: string, delta: number): string => {
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return formatDateKey(dt);
  }, []);

  return {
    dayTodos,
    stats,
    addTodo,
    removeTodo,
    reorderTodo,
    toggleComplete,
    updateTodo,
    startTiming,
    pauseTiming,
    stopTiming,
    getLiveElapsed,
    getCountdownRemaining,
    shiftDate,
  };
}
