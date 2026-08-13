import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Todo } from "../types";
import { RECURRENCE_LABELS, URGENCY_LABELS } from "../types";
import { formatDuration } from "../utils/time";
import { flattenMiniSubtasks } from "../utils/miniSubtasks";
import {
  IconCheck,
  IconBell,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconClockHour4,
  IconDockBottom,
  IconDockTop,
  IconFlame,
  IconPlayerPause,
  IconPlayerPlay,
  IconRestore,
  IconRepeat,
  IconTrash,
} from "./icons";

interface MiniTodoBarProps {
  todo: Todo | null;
  index: number;
  total: number;
  liveElapsed: number;
  remaining: number;
  onWheelNavigate: (direction: -1 | 1) => void;
  onOpacityChange: (direction: -1 | 1) => void;
  autoHideEnabled: boolean;
  autoHideRevealed: boolean;
  subtasksOpen: boolean;
  subtasksHovered: boolean;
  onToggleAutoHide: () => void;
  onReveal: () => void;
  onHide: () => void;
  onToggleSubtasks: () => void;
  onStart: () => void;
  onPause: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onRestore: () => void;
}

const WHEEL_NAVIGATION_THRESHOLD = 70;
const WHEEL_OPACITY_THRESHOLD = 50;
const AUTO_HIDE_DELAY_MS = 360;
const TOP_EDGE_LEAVE_GUARD = 16;
const SWITCH_ANIMATION_MS = 260;
type SwitchDirection = "up" | "down" | null;

function getWheelDelta(event: WheelEvent) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * 80;
  return event.deltaY;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest("button, input, select, textarea, a")
    : null;
}

export function MiniTodoBar({
  todo,
  index,
  total,
  liveElapsed,
  remaining,
  onWheelNavigate,
  onOpacityChange,
  autoHideEnabled,
  autoHideRevealed,
  subtasksOpen,
  subtasksHovered,
  onToggleAutoHide,
  onReveal,
  onHide,
  onToggleSubtasks,
  onStart,
  onPause,
  onToggle,
  onRemove,
  onRestore,
}: MiniTodoBarProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const hideDelayRef = useRef<number | null>(null);
  const switchAnimationRef = useRef<number | null>(null);
  const lastPointerYRef = useRef<number | null>(null);
  const subtasksHoveredRef = useRef(subtasksHovered);
  const navigationWheelDeltaRef = useRef(0);
  const opacityWheelDeltaRef = useRef(0);
  const [switchDirection, setSwitchDirection] =
    useState<SwitchDirection>(null);
  const subtaskCount = todo ? flattenMiniSubtasks(todo.subtasks ?? []).length : 0;

  const clearScheduledHide = () => {
    if (hideDelayRef.current == null) return;
    window.clearTimeout(hideDelayRef.current);
    hideDelayRef.current = null;
  };

  useEffect(() => {
    subtasksHoveredRef.current = subtasksHovered;
  }, [subtasksHovered]);

  useEffect(() => {
    if (!autoHideEnabled || !autoHideRevealed || subtasksHovered) return;
    clearScheduledHide();

    hideDelayRef.current = window.setTimeout(() => {
      hideDelayRef.current = null;
      if (!shellRef.current?.matches(":hover")) {
        onHide();
      }
    }, AUTO_HIDE_DELAY_MS);

    return () => clearScheduledHide();
  }, [autoHideEnabled, autoHideRevealed, onHide, subtasksHovered]);

  const triggerSwitchAnimation = (direction: Exclude<SwitchDirection, null>) => {
    if (switchAnimationRef.current != null) {
      window.clearTimeout(switchAnimationRef.current);
    }

    setSwitchDirection(null);
    window.requestAnimationFrame(() => {
      setSwitchDirection(direction);
      switchAnimationRef.current = window.setTimeout(() => {
        switchAnimationRef.current = null;
        setSwitchDirection(null);
      }, SWITCH_ANIMATION_MS);
    });
  };

  const navigateMiniTodo = (direction: -1 | 1) => {
    triggerSwitchAnimation(direction > 0 ? "up" : "down");
    onWheelNavigate(direction);
  };

  const handleWheelDelta = (event: WheelEvent) => {
    const delta = getWheelDelta(event);
    if (delta === 0) return;

    if (event.ctrlKey) {
      opacityWheelDeltaRef.current += delta;
      if (Math.abs(opacityWheelDeltaRef.current) < WHEEL_OPACITY_THRESHOLD) {
        return;
      }

      onOpacityChange(opacityWheelDeltaRef.current > 0 ? -1 : 1);
      opacityWheelDeltaRef.current = 0;
      return;
    }

    if (total <= 1) return;

    navigationWheelDeltaRef.current += delta;
    if (
      Math.abs(navigationWheelDeltaRef.current) <
      WHEEL_NAVIGATION_THRESHOLD
    ) {
      return;
    }

    navigateMiniTodo(navigationWheelDeltaRef.current > 0 ? 1 : -1);
    navigationWheelDeltaRef.current = 0;
  };

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handleWheelDelta(event);
    };

    shell.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      shell.removeEventListener("wheel", handleWheel, { capture: true });
    };
  });

  useEffect(
    () => () => {
      clearScheduledHide();
      if (switchAnimationRef.current != null) {
        window.clearTimeout(switchAnimationRef.current);
      }
    },
    [],
  );

  const handleMouseDown = async (event: MouseEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } catch {
      /* browser */
    }
  };

  const handleMouseEnter = (event: MouseEvent<HTMLElement>) => {
    lastPointerYRef.current = event.clientY;
    clearScheduledHide();
    if (!autoHideEnabled) return;
    if (isCollapsed) {
      const shellHeight = shellRef.current?.clientHeight ?? 0;
      const revealEdgeStart = Math.max(0, shellHeight - TOP_EDGE_LEAVE_GUARD);
      if (event.clientY < revealEdgeStart) return;
    }
    onReveal();
  };

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    lastPointerYRef.current = event.clientY;
  };

  const handleMouseLeave = (event: MouseEvent<HTMLElement>) => {
    lastPointerYRef.current = event.clientY;
    if (!autoHideEnabled) return;
    clearScheduledHide();

    if (event.clientY <= TOP_EDGE_LEAVE_GUARD) return;

    hideDelayRef.current = window.setTimeout(() => {
      hideDelayRef.current = null;
      const lastPointerY = lastPointerYRef.current;
      const hoveredSubtasks = subtasksHoveredRef.current;
      if (
        !shellRef.current?.matches(":hover") &&
        !(subtasksOpen && hoveredSubtasks) &&
        (lastPointerY == null || lastPointerY > TOP_EDGE_LEAVE_GUARD)
      ) {
        onHide();
      }
    }, AUTO_HIDE_DELAY_MS);
  };

  const handleToggleAutoHide = () => {
    clearScheduledHide();
    onToggleAutoHide();
  };

  const countdownEnabled = Boolean(
    todo?.countdownEnabled && todo.plannedSeconds > 0,
  );
  const countdownProgress = todo && countdownEnabled
    ? Math.max(0, Math.min(100, (remaining / todo.plannedSeconds) * 100))
    : 0;
  const isOvertime =
    todo != null && countdownEnabled && liveElapsed > todo.plannedSeconds;
  const isCollapsed = autoHideEnabled && !autoHideRevealed;

  return (
    <main
      ref={shellRef}
      className={["mini-shell", isCollapsed ? "is-collapsed" : ""]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {todo ? (
        <div className="mini-todo-stack">
          <article
            className={[
              "mini-todo",
              countdownEnabled ? "has-countdown" : "",
              isOvertime ? "is-overtime" : "",
              switchDirection ? `is-switching-${switchDirection}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="mini-todo__nav">
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => navigateMiniTodo(-1)}
                disabled={total <= 1}
                aria-label="上一个待办"
                title="上一个待办"
              >
                <IconChevronUp size={15} />
              </button>
              <span className="mini-todo__count">
                {index + 1}/{total}
              </span>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={() => navigateMiniTodo(1)}
                disabled={total <= 1}
                aria-label="下一个待办"
                title="下一个待办"
              >
                <IconChevronDown size={15} />
              </button>
            </div>

            <button
              type="button"
              className={`check-btn mini-todo__check ${
                todo.completed ? "is-checked" : ""
              }`}
              onClick={onToggle}
              aria-label="标记完成"
              title="标记完成"
            >
              {todo.completed ? <IconCheck size={14} /> : null}
            </button>

            <div className="mini-todo__main">
              <div className="mini-todo__title-row">
                <h2 className="mini-todo__title">{todo.title}</h2>
                <span
                  className={`urgency-icon urgency-icon--${todo.urgency}`}
                  title={`紧急程度：${URGENCY_LABELS[todo.urgency]}`}
                  aria-label={`紧急程度：${URGENCY_LABELS[todo.urgency]}`}
                >
                  <IconFlame size={13} />
                </span>
                <span
                  className={`status-badge status-badge--${
                    todo.isTiming ? "active" : "idle"
                  }`}
                >
                  {todo.isTiming ? "进行中" : "待开始"}
                </span>
              </div>
              <div className="mini-todo__meta">
                {countdownEnabled && (
                  <span className="mini-todo__meta-item">
                    <IconClock size={13} />
                    计划 {formatDuration(todo.plannedSeconds)}
                  </span>
                )}
                {todo.recordTimeEnabled && (
                  <span className="mini-todo__meta-item">
                    <IconClockHour4 size={13} />
                    已用 {formatDuration(liveElapsed)}
                  </span>
                )}
                {todo.reminderEnabled && todo.reminderTime && (
                  <span className="mini-todo__meta-item mini-todo__meta-item--reminder">
                    <IconBell size={13} />
                    提醒 {todo.reminderTime}
                  </span>
                )}
                {todo.recurrence && (
                  <span className="mini-todo__meta-item">
                    <IconRepeat size={13} />
                    {RECURRENCE_LABELS[todo.recurrence.frequency]}
                  </span>
                )}
                {subtaskCount > 0 && (
                  <button
                    type="button"
                    className={`mini-todo__meta-item mini-todo__meta-item--subtasks ${
                      subtasksOpen ? "is-open" : ""
                    }`}
                    onClick={onToggleSubtasks}
                    aria-expanded={subtasksOpen}
                    title={subtasksOpen ? "收起子待办" : "展开子待办"}
                  >
                    <span>{subtaskCount} 个子待办</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mini-todo__actions">
              {todo.isTiming ? (
                <button
                  type="button"
                  className="mini-action-btn mini-action-btn--secondary"
                  onClick={onPause}
                  aria-label="暂停计时"
                  title="暂停计时"
                >
                  <IconPlayerPause size={14} />
                </button>
              ) : todo.recordTimeEnabled ? (
                <button
                  type="button"
                  className="mini-action-btn mini-action-btn--primary"
                  onClick={onStart}
                  aria-label="开始计时"
                  title="开始计时"
                >
                  <IconPlayerPlay size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="mini-icon-btn"
                onClick={handleToggleAutoHide}
                aria-label={autoHideEnabled ? "取消收起" : "收起到顶部"}
                title={autoHideEnabled ? "取消收起" : "收起到顶部"}
              >
                {autoHideEnabled ? (
                  <IconDockBottom size={14} />
                ) : (
                  <IconDockTop size={14} />
                )}
              </button>
              <button
                type="button"
                className="mini-icon-btn btn-delete"
                onClick={onRemove}
                aria-label="删除"
                title="删除"
              >
                <IconTrash size={14} />
              </button>
              <button
                type="button"
                className="mini-icon-btn"
                onClick={onRestore}
                aria-label="还原窗口"
                title="还原窗口"
              >
                <IconRestore size={14} />
              </button>
            </div>

            {countdownEnabled && liveElapsed > 0 && (
              <div className="mini-todo__countdown-progress" aria-hidden>
                <div
                  className="mini-todo__countdown-fill"
                  style={{ width: `${countdownProgress}%` }}
                />
              </div>
            )}
          </article>

        </div>
      ) : (
        <section className="mini-empty">
          <span>暂无未完成待办</span>
          <button
            type="button"
            className="mini-icon-btn"
            onClick={onRestore}
            aria-label="还原窗口"
            title="还原窗口"
          >
            <IconRestore size={14} />
          </button>
        </section>
      )}
    </main>
  );
}
