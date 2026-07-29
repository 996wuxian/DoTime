import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IconChevronDown } from "./icons";

interface MonthDaySelectProps {
  value: number;
  onChange: (day: number) => void;
}

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const MENU_HEIGHT = 236;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;

export function MonthDaySelect({ value, onChange }: MonthDaySelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = rect.width;
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
    );
    const hasRoomBelow =
      rect.bottom + MENU_GAP + MENU_HEIGHT <=
      window.innerHeight - VIEWPORT_PADDING;
    const rawTop = hasRoomBelow
      ? rect.bottom + MENU_GAP
      : rect.top - MENU_HEIGHT - MENU_GAP;
    const top = Math.min(
      Math.max(VIEWPORT_PADDING, rawTop),
      Math.max(
        VIEWPORT_PADDING,
        window.innerHeight - MENU_HEIGHT - VIEWPORT_PADDING,
      ),
    );

    setPosition({ left, top, width });
  };

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      const selected = selectedRef.current;
      if (menu && selected) {
        menu.scrollTop = Math.max(
          0,
          selected.offsetTop - (menu.clientHeight - selected.offsetHeight) / 2,
        );
        selected.focus();
      }
    });
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
    const handleViewportChange = (event?: Event) => {
      const target = event?.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      updatePosition();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="month-day-select">
      <button
        ref={triggerRef}
        type="button"
        className="month-day-select__trigger"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{value} 日</span>
        <IconChevronDown size={14} />
      </button>
      {open && position && (
        <div
          ref={menuRef}
          className="month-day-select__menu"
          role="listbox"
          aria-label="每月日期"
          style={position}
        >
          {MONTH_DAYS.map((day) => (
            <button
              key={day}
              ref={day === value ? selectedRef : undefined}
              type="button"
              className={day === value ? "is-active" : ""}
              role="option"
              aria-selected={day === value}
              onClick={() => {
                onChange(day);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              每月 {day} 日
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
