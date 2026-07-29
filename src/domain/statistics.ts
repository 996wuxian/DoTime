import type { Todo } from "../types";
import { parseDateKey, shiftDateKey } from "../utils/calendar";
import { formatDateKey } from "../utils/time";

export type StatisticsPeriod = "week" | "month";

export interface StatisticsRange {
  startDate: string;
  endDate: string;
}

export interface StatisticsDay {
  date: string;
  total: number;
  completed: number;
  elapsedSeconds: number;
}

export interface StatisticsTask {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  elapsedSeconds: number;
}

export interface StatisticsReport extends StatisticsRange {
  total: number;
  completed: number;
  completionRate: number;
  timing: number;
  elapsedSeconds: number;
  days: StatisticsDay[];
  topTasks: StatisticsTask[];
}

export function getStatisticsRange(
  anchorDate: string,
  period: StatisticsPeriod,
): StatisticsRange {
  const anchor = parseDateKey(anchorDate);
  if (period === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { startDate: formatDateKey(start), endDate: formatDateKey(end) };
  }

  const mondayOffset = (anchor.getDay() + 6) % 7;
  const startDate = shiftDateKey(anchorDate, -mondayOffset);
  return { startDate, endDate: shiftDateKey(startDate, 6) };
}

export function shiftStatisticsAnchor(
  anchorDate: string,
  period: StatisticsPeriod,
  delta: number,
): string {
  if (period === "week") return shiftDateKey(anchorDate, delta * 7);
  const anchor = parseDateKey(anchorDate);
  const target = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + delta,
    Math.min(
      anchor.getDate(),
      new Date(anchor.getFullYear(), anchor.getMonth() + delta + 1, 0).getDate(),
    ),
  );
  return formatDateKey(target);
}

export function getTodoElapsedSeconds(todo: Todo, now = Date.now()): number {
  if (todo.actualDurationSeconds != null) {
    return Math.max(0, todo.actualDurationSeconds);
  }
  const activeSeconds =
    todo.isTiming && todo.timingStartedAt != null
      ? Math.max(0, Math.floor((now - todo.timingStartedAt) / 1000))
      : 0;
  return Math.max(0, todo.elapsedSeconds + activeSeconds);
}

export function buildStatisticsReport(
  todos: readonly Todo[],
  anchorDate: string,
  period: StatisticsPeriod,
  now = Date.now(),
): StatisticsReport {
  const range = getStatisticsRange(anchorDate, period);
  const days: StatisticsDay[] = [];
  const dayByDate = new Map<string, StatisticsDay>();
  for (
    let date = range.startDate;
    date <= range.endDate;
    date = shiftDateKey(date, 1)
  ) {
    const day = { date, total: 0, completed: 0, elapsedSeconds: 0 };
    days.push(day);
    dayByDate.set(date, day);
  }

  const rangeTodos = todos.filter(
    (todo) => todo.date >= range.startDate && todo.date <= range.endDate,
  );
  const topTasks = rangeTodos
    .map((todo) => {
      const elapsedSeconds = getTodoElapsedSeconds(todo, now);
      const day = dayByDate.get(todo.date);
      if (day) {
        day.total += 1;
        if (todo.completed) day.completed += 1;
        day.elapsedSeconds += elapsedSeconds;
      }
      return {
        id: todo.id,
        title: todo.title,
        date: todo.date,
        completed: todo.completed,
        elapsedSeconds,
      };
    })
    .filter((todo) => todo.elapsedSeconds > 0)
    .sort(
      (a, b) =>
        b.elapsedSeconds - a.elapsedSeconds ||
        a.date.localeCompare(b.date) ||
        a.title.localeCompare(b.title, "zh-CN"),
    )
    .slice(0, 5);

  const completed = rangeTodos.filter((todo) => todo.completed).length;
  const elapsedSeconds = days.reduce(
    (total, day) => total + day.elapsedSeconds,
    0,
  );
  return {
    ...range,
    total: rangeTodos.length,
    completed,
    completionRate:
      rangeTodos.length === 0 ? 0 : completed / rangeTodos.length,
    timing: rangeTodos.filter((todo) => todo.isTiming).length,
    elapsedSeconds,
    days,
    topTasks,
  };
}
