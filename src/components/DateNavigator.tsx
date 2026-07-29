import { useEffect, useRef, useState } from "react";
import type { TodoDateSummary } from "../types";
import { shiftDateKey } from "../utils/calendar";
import { formatDateKey, formatDisplayDate } from "../utils/time";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
} from "./icons";
import { CalendarPopover } from "./CalendarPopover";

interface DateNavigatorProps {
  value: string;
  todoSummaries: ReadonlyMap<string, TodoDateSummary>;
  onChange: (date: string) => void;
}

export function DateNavigator({
  value,
  todoSummaries,
  onChange,
}: DateNavigatorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const today = formatDateKey();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
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

  const selectDate = (date: string) => {
    onChange(date);
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
        <CalendarPopover
          value={value}
          todoSummaries={todoSummaries}
          onSelect={selectDate}
        />
      )}
    </div>
  );
}
