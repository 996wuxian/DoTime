import { useMemo, type CSSProperties } from "react";
import type { Todo } from "../types";
import {
  buildStatisticsReport,
  shiftStatisticsAnchor,
  type StatisticsPeriod,
} from "../domain/statistics";
import {
  formatDateKey,
  formatDisplayDate,
  formatDurationCompact,
} from "../utils/time";
import { parseDateKey, shiftDateKey } from "../utils/calendar";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconClockHour4,
  IconListCheck,
  IconPlayerPlay,
} from "./icons";

interface StatisticsCenterProps {
  todos: readonly Todo[];
  anchorDate: string;
  period: StatisticsPeriod;
  onPeriodChange: (period: StatisticsPeriod) => void;
  onAnchorDateChange: (date: string) => void;
  onSelectDate: (date: string) => void;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  weekday: "short",
});
const MONTH_LABELS = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

function formatRange(startDate: string, endDate: string) {
  return `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
}

function formatDayLabel(dateKey: string, period: StatisticsPeriod) {
  const date = new Date(`${dateKey}T00:00:00`);
  return period === "week"
    ? WEEKDAY_FORMATTER.format(date).replace("周", "")
    : String(date.getDate());
}

type HeatmapDay = {
  date: string;
  total: number;
  completed: number;
  level: number;
};

function buildTodoHeatmap(todos: readonly Todo[]) {
  const today = new Date();
  const startDate = formatDateKey(new Date(today.getFullYear(), 0, 1));
  const endDate = formatDateKey(new Date(today.getFullYear(), 11, 31));
  const firstDate = parseDateKey(startDate);
  const leadingEmptyDays = (firstDate.getDay() + 6) % 7;
  const counts = new Map<string, { total: number; completed: number }>();

  for (const todo of todos) {
    if (todo.date < startDate || todo.date > endDate) continue;
    const current = counts.get(todo.date) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (todo.completed) current.completed += 1;
    counts.set(todo.date, current);
  }

  const maxTotal = Math.max(1, ...Array.from(counts.values(), (day) => day.total));
  const days: HeatmapDay[] = [];
  for (let date = startDate; date <= endDate; date = shiftDateKey(date, 1)) {
    const count = counts.get(date) ?? { total: 0, completed: 0 };
    days.push({
      date,
      total: count.total,
      completed: count.completed,
      level:
        count.total === 0 ? 0 : Math.max(1, Math.ceil((count.total / maxTotal) * 4)),
    });
  }

  const cells = [
    ...Array.from({ length: leadingEmptyDays }, () => null),
    ...days,
  ];
  const trailingEmptyDays = (7 - (cells.length % 7)) % 7;
  cells.push(...Array.from({ length: trailingEmptyDays }, () => null));

  const monthLabels: { label: string; column: number }[] = [];
  let previousMonth = "";
  cells.forEach((day, index) => {
    if (day == null) return;
    const date = parseDateKey(day.date);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (date.getDate() !== 1 && monthLabels.length > 0) return;
    if (monthKey === previousMonth) return;
    previousMonth = monthKey;
    monthLabels.push({
      label: MONTH_LABELS[date.getMonth()],
      column: Math.floor(index / 7) + 1,
    });
  });

  return {
    cells,
    monthLabels,
    weekCount: Math.ceil(cells.length / 7),
    dayCount: days.length,
    total: days.reduce((sum, day) => sum + day.total, 0),
  };
}

export function StatisticsCenter({
  todos,
  anchorDate,
  period,
  onPeriodChange,
  onAnchorDateChange,
  onSelectDate,
}: StatisticsCenterProps) {
  const report = buildStatisticsReport(todos, anchorDate, period);
  const maxElapsed = Math.max(
    1,
    ...report.days.map((day) => day.elapsedSeconds),
  );
  const maxCompleted = Math.max(1, ...report.days.map((day) => day.completed));
  const topElapsed = report.topTasks[0]?.elapsedSeconds ?? 1;
  const heatmap = useMemo(() => buildTodoHeatmap(todos), [todos]);

  const shiftPeriod = (delta: -1 | 1) => {
    onAnchorDateChange(shiftStatisticsAnchor(anchorDate, period, delta));
  };

  return (
    <section className="statistics-center" aria-labelledby="statistics-title">
      <header className="statistics-header">
        <div>
          <h2 id="statistics-title">耗时统计</h2>
          <p>{formatRange(report.startDate, report.endDate)}</p>
        </div>
        <div className="statistics-header__controls">
          <div className="statistics-period" role="group" aria-label="统计周期">
            <button
              type="button"
              className={period === "week" ? "is-active" : ""}
              onClick={() => onPeriodChange("week")}
              aria-pressed={period === "week"}
            >
              本周
            </button>
            <button
              type="button"
              className={period === "month" ? "is-active" : ""}
              onClick={() => onPeriodChange("month")}
              aria-pressed={period === "month"}
            >
              本月
            </button>
          </div>
          <div className="statistics-navigation">
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              onClick={() => shiftPeriod(-1)}
              aria-label={`上${period === "week" ? "一周" : "个月"}`}
              title={`上${period === "week" ? "一周" : "个月"}`}
            >
              <IconChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="btn btn-ghost statistics-navigation__current"
              onClick={() => onAnchorDateChange(formatDateKey())}
            >
              本期
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              onClick={() => shiftPeriod(1)}
              aria-label={`下${period === "week" ? "一周" : "个月"}`}
              title={`下${period === "week" ? "一周" : "个月"}`}
            >
              <IconChevronRight size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="statistics-summary" aria-label="统计概览">
        <article className="statistics-metric">
          <IconListCheck size={17} />
          <span>任务</span>
          <strong>{report.total}</strong>
        </article>
        <article className="statistics-metric is-success">
          <IconCircleCheck size={17} />
          <span>已完成</span>
          <strong>{report.completed}</strong>
        </article>
        <article className="statistics-metric is-warning">
          <IconPlayerPlay size={17} />
          <span>完成率</span>
          <strong>{Math.round(report.completionRate * 100)}%</strong>
        </article>
        <article className="statistics-metric is-primary">
          <IconClockHour4 size={17} />
          <span>累计耗时</span>
          <strong>
            {report.elapsedSeconds > 0
              ? formatDurationCompact(report.elapsedSeconds)
              : "—"}
          </strong>
          {report.timing > 0 && <small>{report.timing} 项计时中</small>}
        </article>
      </div>

      <section className="statistics-section" aria-labelledby="trend-title">
        <section
          className="statistics-heatmap"
          aria-labelledby="todo-heatmap-title"
        >
          <div className="statistics-heatmap__header">
            <div>
              <h3 id="todo-heatmap-title">待办热力图</h3>
              <span>今年 {heatmap.dayCount} 天 · {heatmap.total} 个待办</span>
            </div>
          </div>
          <div className="statistics-heatmap__scroller">
            <div
              className="statistics-heatmap__months"
              style={{ "--heatmap-weeks": heatmap.weekCount } as CSSProperties}
              aria-hidden
            >
              {heatmap.monthLabels.map((month) => (
                <span
                  key={`${month.label}-${month.column}`}
                  style={{ gridColumn: `${month.column} / span 4` }}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div
              className="statistics-heatmap__grid"
              style={{ "--heatmap-weeks": heatmap.weekCount } as CSSProperties}
              aria-label="今年待办热力图"
            >
              {heatmap.cells.map((day, index) =>
                day == null ? (
                  <span
                    key={`empty-${index}`}
                    className="statistics-heatmap__cell is-empty"
                    aria-hidden
                  />
                ) : (
                  <button
                    key={day.date}
                    type="button"
                    className={`statistics-heatmap__cell is-level-${day.level}`}
                    onClick={() => onSelectDate(day.date)}
                    aria-label={`${formatDisplayDate(day.date)}，${day.total} 个待办，${day.completed} 个完成`}
                    title={`${formatDisplayDate(day.date)} · 待办 ${day.total} · 完成 ${day.completed}`}
                  />
                ),
              )}
            </div>
          </div>
        </section>

        <div className="statistics-section__header">
          <div>
            <h3 id="trend-title">每日趋势</h3>
            <span>点击日期查看当天待办</span>
          </div>
          <div className="statistics-legend" aria-label="图例">
            <span><i className="is-time" />耗时</span>
            <span><i className="is-done" />完成</span>
          </div>
        </div>
        <div
          className={`statistics-chart is-${period}`}
          style={{ "--day-count": report.days.length } as CSSProperties}
        >
          {report.days.map((day) => {
            const timeHeight =
              day.elapsedSeconds === 0
                ? 0
                : Math.max(8, (day.elapsedSeconds / maxElapsed) * 100);
            const doneHeight =
              day.completed === 0
                ? 0
                : Math.max(8, (day.completed / maxCompleted) * 100);
            return (
              <button
                key={day.date}
                type="button"
                className="statistics-chart__day"
                onClick={() => onSelectDate(day.date)}
                aria-label={`${formatDisplayDate(day.date)}，${day.completed} 个完成，耗时 ${formatDurationCompact(day.elapsedSeconds)}`}
                title={`${formatDisplayDate(day.date)} · 完成 ${day.completed}/${day.total} · 耗时 ${formatDurationCompact(day.elapsedSeconds)}`}
              >
                <span className="statistics-chart__plot" aria-hidden>
                  <i className="is-time" style={{ height: `${timeHeight}%` }} />
                  <i className="is-done" style={{ height: `${doneHeight}%` }} />
                </span>
                <span className="statistics-chart__label">
                  {formatDayLabel(day.date, period)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="statistics-section" aria-labelledby="ranking-title">
        <div className="statistics-section__header">
          <div>
            <h3 id="ranking-title">耗时排行</h3>
            <span>统计周期内前 5 项</span>
          </div>
        </div>
        {report.topTasks.length === 0 ? (
          <div className="statistics-empty">
            <IconClockHour4 size={22} />
            <span>本期暂无计时记录</span>
          </div>
        ) : (
          <ol className="statistics-ranking">
            {report.topTasks.map((todo, index) => (
              <li key={todo.id}>
                <button type="button" onClick={() => onSelectDate(todo.date)}>
                  <span className="statistics-ranking__index">{index + 1}</span>
                  <span className="statistics-ranking__main">
                    <strong>{todo.title}</strong>
                    <span>
                      <IconCalendarEvent size={13} />
                      {formatDisplayDate(todo.date)}
                      {todo.completed && " · 已完成"}
                    </span>
                    <i
                      aria-hidden
                      style={{ width: `${(todo.elapsedSeconds / topElapsed) * 100}%` }}
                    />
                  </span>
                  <span className="statistics-ranking__duration">
                    {formatDurationCompact(todo.elapsedSeconds)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
