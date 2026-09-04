import { useEffect, useMemo, useState } from "react";
import type { Todo } from "../types";
import {
  getCalendarDays,
  getMonthStart,
  parseDateKey,
  shiftDateKey,
  shiftMonth,
} from "../utils/calendar";
import { formatDateKey, formatDisplayDate } from "../utils/time";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconClockHour4,
  IconListCheck,
} from "./icons";
import { AllTodosTimeline } from "./AllTodosTimeline";

export type PlanPeriod = "week" | "month";

interface PlanOverviewProps {
  todos: readonly Todo[];
  anchorDate: string;
  period: PlanPeriod;
  onPeriodChange: (period: PlanPeriod) => void;
  onAnchorDateChange: (date: string) => void;
  onSelectDate: (date: string) => void;
  onSelectTodo: (todo: Todo) => void;
  onAllTodosOpenChange?: (open: boolean) => void;
}

type PlanDay = {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  total: number;
  pending: number;
  completed: number;
  timing: number;
  topTitles: string[];
};

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MONTH_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
});

function getWeekStart(dateKey: string): string {
  const date = parseDateKey(dateKey);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return formatDateKey(date);
}

function buildPlanDays(
  todos: readonly Todo[],
  anchorDate: string,
  period: PlanPeriod,
): { days: PlanDay[]; startDate: string; endDate: string } {
  const todosByDate = new Map<string, Todo[]>();
  for (const todo of todos) {
    const dayTodos = todosByDate.get(todo.date) ?? [];
    dayTodos.push(todo);
    todosByDate.set(todo.date, dayTodos);
  }

  const dates =
    period === "week"
      ? Array.from({ length: 7 }, (_, index) =>
          shiftDateKey(getWeekStart(anchorDate), index),
        ).map((date) => ({
          dateKey: date,
          day: parseDateKey(date).getDate(),
          isCurrentMonth: true,
        }))
      : getCalendarDays(getMonthStart(parseDateKey(anchorDate)));

  const days = dates.map((day) => {
    const dayTodos = [...(todosByDate.get(day.dateKey) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
    );
    return {
      date: day.dateKey,
      day: day.day,
      isCurrentMonth: day.isCurrentMonth,
      total: dayTodos.length,
      pending: dayTodos.filter((todo) => !todo.completed).length,
      completed: dayTodos.filter((todo) => todo.completed).length,
      timing: dayTodos.filter((todo) => todo.isTiming).length,
      topTitles: dayTodos.slice(0, 4).map((todo) => todo.title),
    };
  });

  return {
    days,
    startDate: days[0]?.date ?? anchorDate,
    endDate: days[days.length - 1]?.date ?? anchorDate,
  };
}

export function PlanOverview({
  todos,
  anchorDate,
  period,
  onPeriodChange,
  onAnchorDateChange,
  onSelectDate,
  onSelectTodo,
  onAllTodosOpenChange,
}: PlanOverviewProps) {
  const [allTodosOpen, setAllTodosOpen] = useState(false);
  useEffect(() => {
    onAllTodosOpenChange?.(allTodosOpen);
  }, [allTodosOpen, onAllTodosOpenChange]);
  const today = formatDateKey();
  const plan = useMemo(
    () => buildPlanDays(todos, anchorDate, period),
    [anchorDate, period, todos],
  );
  const currentMonth = getMonthStart(parseDateKey(anchorDate));
  const total = plan.days.reduce((sum, day) => sum + day.total, 0);
  const pending = plan.days.reduce((sum, day) => sum + day.pending, 0);
  const completed = plan.days.reduce((sum, day) => sum + day.completed, 0);
  const timing = plan.days.reduce((sum, day) => sum + day.timing, 0);
  const allPending = todos.filter((todo) => !todo.completed).length;
  const allCompleted = todos.filter((todo) => todo.completed).length;
  const allTiming = todos.filter((todo) => todo.isTiming).length;

  const shiftPeriod = (delta: -1 | 1) => {
    if (period === "week") {
      onAnchorDateChange(shiftDateKey(anchorDate, delta * 7));
      return;
    }
    onAnchorDateChange(formatDateKey(shiftMonth(currentMonth, delta)));
  };

  const rangeLabel =
    allTodosOpen
      ? `全部日期 · ${todos.length} 个待办`
      : period === "week"
      ? `${formatDisplayDate(plan.startDate)} - ${formatDisplayDate(plan.endDate)}`
      : MONTH_FORMATTER.format(currentMonth);

  const handlePeriodChange = (nextPeriod: PlanPeriod) => {
    setAllTodosOpen(false);
    onPeriodChange(nextPeriod);
  };

  return (
    <section
      className={`plan-overview ${allTodosOpen ? "is-all-todos" : ""}`}
      aria-labelledby="plan-overview-title"
    >
      <header className="plan-overview__header">
        <div>
          <h2 id="plan-overview-title">计划视图</h2>
          <p>{rangeLabel}</p>
        </div>
        <div className="plan-overview__controls">
          <div className="plan-period" role="group" aria-label="计划周期">
            <button
              type="button"
              className={allTodosOpen ? "is-active" : ""}
              onClick={() => setAllTodosOpen(true)}
              aria-pressed={allTodosOpen}
            >
              全部待办
            </button>
            <button
              type="button"
              className={!allTodosOpen && period === "week" ? "is-active" : ""}
              onClick={() => handlePeriodChange("week")}
              aria-pressed={!allTodosOpen && period === "week"}
            >
              周视图
            </button>
            <button
              type="button"
              className={!allTodosOpen && period === "month" ? "is-active" : ""}
              onClick={() => handlePeriodChange("month")}
              aria-pressed={!allTodosOpen && period === "month"}
            >
              月视图
            </button>
          </div>
          {!allTodosOpen && (
            <div className="plan-navigation">
              <button
                type="button"
                className="btn btn-ghost btn-icon-only"
                onClick={() => shiftPeriod(-1)}
                aria-label={period === "week" ? "上一周" : "上个月"}
                title={period === "week" ? "上一周" : "上个月"}
              >
                <IconChevronLeft size={17} />
              </button>
              <button
                type="button"
                className="btn btn-ghost plan-navigation__current"
                onClick={() => onAnchorDateChange(today)}
              >
                本期
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon-only"
                onClick={() => shiftPeriod(1)}
                aria-label={period === "week" ? "下一周" : "下个月"}
                title={period === "week" ? "下一周" : "下个月"}
              >
                <IconChevronRight size={17} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="plan-overview__summary" aria-label="计划概览">
        <article className="plan-metric">
          <IconListCheck size={17} />
          <span>待办</span>
          <strong>{allTodosOpen ? todos.length : total}</strong>
        </article>
        <article className="plan-metric is-warning">
          <IconCalendarEvent size={17} />
          <span>未完成</span>
          <strong>{allTodosOpen ? allPending : pending}</strong>
        </article>
        <article className="plan-metric is-success">
          <IconCircleCheck size={17} />
          <span>已完成</span>
          <strong>{allTodosOpen ? allCompleted : completed}</strong>
        </article>
        <article className="plan-metric is-primary">
          <IconClockHour4 size={17} />
          <span>计时中</span>
          <strong>{allTodosOpen ? allTiming : timing}</strong>
        </article>
      </div>

      <div className="plan-overview__content">
        <div className="plan-overview__main">
          {allTodosOpen ? (
            <AllTodosTimeline
              todos={todos}
              activeDate={anchorDate}
              onSelectTodo={onSelectTodo}
            />
          ) : (
            <>
              {period === "month" && (
                <div className="plan-weekdays" aria-hidden>
                  {WEEKDAYS.map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>
              )}

              <div
                className={`plan-grid plan-grid--${period}`}
                role="list"
                aria-label={period === "week" ? "周计划" : "月计划"}
              >
                {plan.days.map((day, index) => (
                  <button
                    key={`${day.date}-${index}`}
                    type="button"
                    className={[
                      "plan-day",
                      day.date === anchorDate ? "is-selected" : "",
                      day.date === today ? "is-today" : "",
                      day.isCurrentMonth ? "" : "is-outside",
                      day.total > 0 ? "has-todos" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => onSelectDate(day.date)}
                    role="listitem"
                  >
                    <span className="plan-day__header">
                      <span className="plan-day__date">
                        {period === "week" ? WEEKDAYS[index] : day.day}
                      </span>
                      <span className="plan-day__counts">
                        <b>{day.total}</b>
                        <small>待办</small>
                        {day.pending > 0 && <i>{day.pending} 未完成</i>}
                      </span>
                    </span>
                    {period === "week" && (
                      <span className="plan-day__full-date">
                        {formatDisplayDate(day.date)}
                      </span>
                    )}
                    {day.timing > 0 && (
                      <span className="plan-day__timing">
                        <IconClockHour4 size={12} />
                        {day.timing}
                      </span>
                    )}
                    {day.topTitles.length > 0 ? (
                      <span className="plan-day__tasks">
                        {day.topTitles.map((title) => (
                          <em key={title}>{title}</em>
                        ))}
                        {day.total > day.topTitles.length && (
                          <span className="plan-day__more" aria-hidden="true">
                            ...
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="plan-day__empty">暂无待办</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
