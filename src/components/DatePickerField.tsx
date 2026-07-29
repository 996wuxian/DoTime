import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TodoDateSummary } from "../types";
import { formatDisplayDate } from "../utils/time";
import { CalendarPopover } from "./CalendarPopover";
import { IconCalendarEvent, IconClose } from "./icons";

interface DatePickerFieldProps {
  label: string;
  value: string | null;
  fallbackDate: string;
  todoSummaries: ReadonlyMap<string, TodoDateSummary>;
  minDate?: string;
  optional?: boolean;
  emptyLabel?: string;
  onChange: (date: string | null) => void;
}

const CALENDAR_WIDTH = 324;
const CALENDAR_HEIGHT = 388;
const VIEWPORT_PADDING = 8;
const APP_CONTENT_TOP = 56;
const POPOVER_GAP = 8;

export function DatePickerField({
  label,
  value,
  fallbackDate,
  todoSummaries,
  minDate,
  optional = false,
  emptyLabel = "不设结束日期",
  onChange,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const calendarValue = value ?? fallbackDate;

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const alignedLeft = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      Math.max(VIEWPORT_PADDING, window.innerWidth - CALENDAR_WIDTH - VIEWPORT_PADDING),
    );
    const hasRoomBelow =
      rect.bottom + POPOVER_GAP + CALENDAR_HEIGHT <=
      window.innerHeight - VIEWPORT_PADDING;
    const hasRoomAbove =
      rect.top - POPOVER_GAP - CALENDAR_HEIGHT >= APP_CONTENT_TOP;
    let left = alignedLeft;
    let top: number;

    if (hasRoomBelow) {
      top = rect.bottom + POPOVER_GAP;
    } else if (hasRoomAbove) {
      top = rect.top - CALENDAR_HEIGHT - POPOVER_GAP;
    } else {
      const hasRoomRight =
        rect.right + POPOVER_GAP + CALENDAR_WIDTH <=
        window.innerWidth - VIEWPORT_PADDING;
      const hasRoomLeft =
        rect.left - POPOVER_GAP - CALENDAR_WIDTH >= VIEWPORT_PADDING;
      if (hasRoomRight) left = rect.right + POPOVER_GAP;
      else if (hasRoomLeft) left = rect.left - CALENDAR_WIDTH - POPOVER_GAP;
      top = Math.min(
        Math.max(APP_CONTENT_TOP, rect.top + rect.height / 2 - CALENDAR_HEIGHT / 2),
        Math.max(
          APP_CONTENT_TOP,
          window.innerHeight - CALENDAR_HEIGHT - VIEWPORT_PADDING,
        ),
      );
    }
    setPosition({ position: "fixed", left, right: "auto", top });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();

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
    const handleViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectDate = (date: string) => {
    onChange(date);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="field date-picker-field">
      <span className="field__label">{label}</span>
      <div className="date-picker-field__control">
        <button
          ref={triggerRef}
          type="button"
          className={`date-picker-field__trigger ${value == null ? "is-empty" : ""}`}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <IconCalendarEvent size={15} />
          <span>{value == null ? emptyLabel : formatDisplayDate(value)}</span>
        </button>
        {optional && value != null && (
          <button
            type="button"
            className="date-picker-field__clear"
            onClick={() => onChange(null)}
            aria-label={`清除${label}`}
            title={`清除${label}`}
          >
            <IconClose size={14} />
          </button>
        )}
      </div>
      {open && position && (
        <CalendarPopover
          value={calendarValue}
          todoSummaries={todoSummaries}
          minDate={minDate}
          style={position}
          onSelect={selectDate}
        />
      )}
    </div>
  );
}
