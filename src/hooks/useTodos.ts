import { useCallback, useEffect, useMemo, useState } from "react";
import type { Todo, Urgency } from "../types";
import { URGENCY_ORDER } from "../types";
import { formatDateKey } from "../utils/time";

const STORAGE_KEY = "dotime-todos-v1";

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Todo[];
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useTodos(selectedDate: string) {
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  const [tick, setTick] = useState(0);

  // 持久化
  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  // 计时中每秒刷新 UI
  useEffect(() => {
    const hasTiming = todos.some((t) => t.isTiming);
    if (!hasTiming) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [todos]);

  const dayTodos = useMemo(() => {
    void tick; // 依赖 tick 以刷新进行中的计时显示
    return todos
      .filter((t) => t.date === selectedDate)
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        if (a.isTiming !== b.isTiming) return a.isTiming ? -1 : 1;
        return URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      });
  }, [todos, selectedDate, tick]);

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
    (title: string, urgency: Urgency, plannedSeconds: number, date?: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const todo: Todo = {
        id: createId(),
        title: trimmed,
        urgency,
        date: date ?? selectedDate,
        plannedSeconds: Math.max(60, plannedSeconds),
        completed: false,
        isTiming: false,
        timingStartedAt: null,
        elapsedSeconds: 0,
        actualDurationSeconds: null,
        createdAt: Date.now(),
        completedAt: null,
      };
      setTodos((prev) => [todo, ...prev]);
    },
    [selectedDate],
  );

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleComplete = useCallback((id: string) => {
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.completed) {
          return { ...t, completed: false, completedAt: null };
        }
        // 完成时若仍在计时，先结算
        let elapsed = t.elapsedSeconds;
        if (t.isTiming && t.timingStartedAt) {
          elapsed += Math.floor((Date.now() - t.timingStartedAt) / 1000);
        }
        return {
          ...t,
          completed: true,
          completedAt: Date.now(),
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: elapsed,
          actualDurationSeconds: elapsed > 0 ? elapsed : t.actualDurationSeconds,
        };
      }),
    );
  }, []);

  const updatePlanned = useCallback((id: string, plannedSeconds: number) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id && !t.isTiming
          ? { ...t, plannedSeconds: Math.max(60, plannedSeconds) }
          : t,
      ),
    );
  }, []);

  const startTiming = useCallback((id: string) => {
    setTodos((prev) =>
      prev.map((t) => {
        // 同时只允许一个任务在计时：暂停其他
        if (t.id === id) {
          if (t.completed || t.isTiming) return t;
          return { ...t, isTiming: true, timingStartedAt: Date.now() };
        }
        if (t.isTiming && t.timingStartedAt) {
          const extra = Math.floor((Date.now() - t.timingStartedAt) / 1000);
          return {
            ...t,
            isTiming: false,
            timingStartedAt: null,
            elapsedSeconds: t.elapsedSeconds + extra,
          };
        }
        return t;
      }),
    );
  }, []);

  const stopTiming = useCallback((id: string) => {
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id || !t.isTiming || !t.timingStartedAt) return t;
        const extra = Math.floor((Date.now() - t.timingStartedAt) / 1000);
        const total = t.elapsedSeconds + extra;
        return {
          ...t,
          isTiming: false,
          timingStartedAt: null,
          elapsedSeconds: total,
          actualDurationSeconds: total,
          completed: true,
          completedAt: Date.now(),
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
    toggleComplete,
    updatePlanned,
    startTiming,
    stopTiming,
    getLiveElapsed,
    getCountdownRemaining,
    shiftDate,
  };
}
