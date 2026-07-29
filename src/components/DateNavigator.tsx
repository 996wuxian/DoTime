import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { formatDateKey, formatDisplayDate } from "../utils/time";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
} from "./icons";

interface DateNavigatorProps {
  value: string;
  todoSummaries: ReadonlyMap<string, TodoDateSummary>;
  onChange: (date: string) => void;
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

export function DateNavigator({
  value,
  todoSummaries,
  onChange,
}: DateNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    getMonthStart(parseDateKey(value)),
  );
  const [focusedDate, setFocusedDate] = useState(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const today = formatDateKey();
  const days = useMemo(() => getCalendarDays(viewMonth), [viewMonth]);

  useEffect(() => {
    if (!open) return;
    setViewMonth(getMonthStart(parseDateKey(value)));
    setFocusedDate(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      dayRefs.current.get(focusedDate)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedDate, open, viewMonth]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const focusDate = (dateKey: string) => {
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
    setFocusedDate(formatDateKey(nextMonth));
  };

  const handleDayKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    dateKey: string,
  ) => {
    const movements: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((parseDateKey(dateKey).getDay() + 6) % 7),
      End: 6 - ((parseDateKey(dateKey).getDay() + 6) % 7),
    };
    const movement = movements[event.key];
    if (movement != null) {
      event.preventDefault();
      focusDate(shiftDateKey(dateKey, movement));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const nextMonth = shiftMonth(
        parseDateKey(dateKey),
        event.key === "PageUp" ? -1 : 1,
      );
      focusDate(formatDateKey(nextMonth));
    }
  };

  const selectDate = (dateKey: string) => {
    onChange(dateKey);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="date-navigator">
      <div className="date-nav">
        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          onClick={() => onChange(shiftDateKey(value, -1))}
          aria-label="前一天"
          title="前一天"
        >
          <IconChevronLeft size={18} />
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="date-nav__current"
          onClick={() => setOpen((current) => !current)}
          aria-label="选择日期"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="选择日期"
        >
          <IconCalendarEvent size={14} />
          <span className="date-nav__text">{formatDisplayDate(value)}</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          onClick={() => onChange(shiftDateKey(value, 1))}
          aria-label="后一天"
          title="后一天"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {value !== today && (
        <button
          type="button"
          className="btn btn-ghost date-navigator__today"
          onClick={() => onChange(today)}
        >
          今天
        </button>
      )}

      {open && (
        <section
          className="calendar-popover"
          role="dialog"
          aria-label="选择待办日期"
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
                  tabIndex={focusedDate === day.dateKey ? 0 : -1}
                  aria-label={`${DATE_ARIA_FORMATTER.format(
                    parseDateKey(day.dateKey),
                  )}${taskLabel}`}
                  aria-selected={day.dateKey === value}
                  onClick={() => selectDate(day.dateKey)}
                  onKeyDown={(event) => handleDayKeyDown(event, day.dateKey)}
                >
                  <span>{day.day}</span>
                  {summary && (
                    <small aria-hidden>{Math.min(summary.total, 99)}</small>
                  )}
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
            <button type="button" onClick={() => selectDate(today)}>
              回到今天
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
