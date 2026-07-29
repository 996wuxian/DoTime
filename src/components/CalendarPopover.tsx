import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { TodoDateSummary } from "../types";
import {
  getCalendarDays,
  getMonthStart,
  parseDateKey,
  shiftDateKey,
  shiftMonth,
} from "../utils/calendar";
import { formatDateKey } from "../utils/time";
import { IconChevronLeft, IconChevronRight } from "./icons";

interface CalendarPopoverProps {
  value: string;
  todoSummaries?: ReadonlyMap<string, TodoDateSummary>;
  minDate?: string;
  style?: CSSProperties;
  onSelect: (date: string) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
});
const DATE_ARIA_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

export function CalendarPopover({
  value,
  todoSummaries = new Map(),
  minDate,
  style,
  onSelect,
}: CalendarPopoverProps) {
  const [viewMonth, setViewMonth] = useState(() =>
    getMonthStart(parseDateKey(value)),
  );
  const [focusedDate, setFocusedDate] = useState(value);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const today = formatDateKey();
  const days = useMemo(() => getCalendarDays(viewMonth), [viewMonth]);

  useEffect(() => {
    setViewMonth(getMonthStart(parseDateKey(value)));
    setFocusedDate(value);
  }, [value]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      dayRefs.current.get(focusedDate)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedDate, viewMonth]);

  const focusDate = (dateKey: string) => {
    if (minDate != null && dateKey < minDate) return;
    const date = parseDateKey(dateKey);
    if (
      date.getFullYear() !== viewMonth.getFullYear() ||
      date.getMonth() !== viewMonth.getMonth()
    ) {
      setViewMonth(getMonthStart(date));
    }
    setFocusedDate(dateKey);
  };

  const changeViewMonth = (delta: number) => {
    const nextMonth = shiftMonth(viewMonth, delta);
    setViewMonth(nextMonth);
    const nextDate = formatDateKey(nextMonth);
    setFocusedDate(minDate != null && nextDate < minDate ? minDate : nextDate);
  };

  const handleDayKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    dateKey: string,
  ) => {
    const weekdayOffset = (parseDateKey(dateKey).getDay() + 6) % 7;
    const movements: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekdayOffset,
      End: 6 - weekdayOffset,
    };
    const movement = movements[event.key];
    if (movement != null) {
      event.preventDefault();
      focusDate(shiftDateKey(dateKey, movement));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      focusDate(
        formatDateKey(
          shiftMonth(parseDateKey(dateKey), event.key === "PageUp" ? -1 : 1),
        ),
      );
    }
  };

  const canSelectToday = minDate == null || today >= minDate;

  return (
    <section
      className="calendar-popover"
      role="dialog"
      aria-label="选择日期"
      style={style}
    >
      <header className="calendar-popover__header">
        <button
          type="button"
          className="btn btn-ghost btn-icon-only calendar-popover__nav"
          onClick={() => changeViewMonth(-1)}
          aria-label="上个月"
          title="上个月"
        >
          <IconChevronLeft size={16} />
        </button>
        <strong>{MONTH_FORMATTER.format(viewMonth)}</strong>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only calendar-popover__nav"
          onClick={() => changeViewMonth(1)}
          aria-label="下个月"
          title="下个月"
        >
          <IconChevronRight size={16} />
        </button>
      </header>

      <div className="calendar-popover__weekdays" aria-hidden>
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="calendar-popover__grid" role="grid">
        {days.map((day) => {
          const summary = todoSummaries.get(day.dateKey);
          const disabled = minDate != null && day.dateKey < minDate;
          const classNames = [
            "calendar-day",
            day.isCurrentMonth ? "" : "is-outside",
            day.dateKey === value ? "is-selected" : "",
            day.dateKey === today ? "is-today" : "",
            summary ? "has-todos" : "",
            summary?.pending === 0 ? "is-all-done" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const taskLabel = summary ? `，${summary.total} 个待办` : "";

          return (
            <button
              key={day.dateKey}
              ref={(node) => {
                if (node) dayRefs.current.set(day.dateKey, node);
                else dayRefs.current.delete(day.dateKey);
              }}
              type="button"
              className={classNames}
              role="gridcell"
              disabled={disabled}
              tabIndex={!disabled && focusedDate === day.dateKey ? 0 : -1}
              aria-label={`${DATE_ARIA_FORMATTER.format(
                parseDateKey(day.dateKey),
              )}${taskLabel}`}
              aria-selected={day.dateKey === value}
              onClick={() => onSelect(day.dateKey)}
              onKeyDown={(event) => handleDayKeyDown(event, day.dateKey)}
            >
              <span>{day.day}</span>
              {summary && <small aria-hidden>{Math.min(summary.total, 99)}</small>}
            </button>
          );
        })}
      </div>

      <footer className="calendar-popover__footer">
        <span>
          <i className="calendar-legend__dot" />有待办
        </span>
        <span>
          <i className="calendar-legend__dot is-done" />已完成
        </span>
        <button
          type="button"
          disabled={!canSelectToday}
          onClick={() => onSelect(today)}
        >
          回到今天
        </button>
      </footer>
    </section>
  );
}
