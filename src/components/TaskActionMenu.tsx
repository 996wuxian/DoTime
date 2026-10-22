import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconDots } from "./icons";
import "./TaskActionMenu.css";

interface TaskAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separator?: boolean;
}

export function TaskActionMenu({ label, actions }: {
  label: string;
  actions: TaskAction[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLastRef = useRef(false);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const top = anchor.bottom + 4 + menu.height <= window.innerHeight - 8
      ? anchor.bottom + 4
      : Math.max(8, anchor.top - menu.height - 4);
    setPosition({
      top,
      left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
    });
    const buttons = menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons[focusLastRef.current ? buttons.length - 1 : 0]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const dismissOnScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const dismissOnResize = () => setOpen(false);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-icon-only task-action-menu__trigger"
        aria-label={label}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusLastRef.current = false;
          setOpen(current => !current);
        }}
        onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          focusLastRef.current = event.key === "ArrowUp";
          setOpen(true);
        }}
      >
        <IconDots size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="task-action-menu"
          style={position}
          onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
              }
              triggerRef.current?.focus({ preventScroll: true });
              setOpen(false);
              return;
            }
            const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(
              menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
            );
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0
              : event.key === "End" ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
        >
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={[
                "task-action-menu__item",
                action.danger ? "is-danger" : "",
                action.separator ? "has-separator" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                triggerRef.current?.focus({ preventScroll: true });
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon}<span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
