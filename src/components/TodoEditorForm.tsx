import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  ReactNode,
  WheelEvent,
} from "react";
import type { Urgency } from "../types";
import { URGENCY_LABELS } from "../types";
import { PRESET_MINUTES } from "../utils/time";
import {
  getDefaultReminderTime,
  normalizeReminderTime,
} from "../utils/reminders";
import { CountdownDial } from "./CountdownDial";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconClose,
  IconBell,
  IconChevronDown,
  IconChevronUp,
  IconFlag,
  IconFlame,
} from "./icons";

export type TodoStatus = "idle" | "active" | "done";

export interface TodoDraft {
  title: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
}

interface TodoEditorFormProps {
  initialDraft: TodoDraft;
  status: TodoStatus;
  title: string;
  titleIcon: ReactNode;
  submitLabel: string;
  className: string;
  autoFocus?: boolean;
  onSubmit: (draft: TodoDraft) => void;
  onCancel: () => void;
}

const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];
const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);
const TIME_PICKER_OPTION_STEP = 34;
const TIME_PICKER_POPOVER_WIDTH = 220;
const TIME_PICKER_POPOVER_HEIGHT = 250;
const TIME_PICKER_POPOVER_GAP = 8;
const TIME_PICKER_VIEWPORT_PADDING = 8;

const STATUS_LABELS: Record<TodoStatus, string> = {
  idle: "待开始",
  active: "进行中",
  done: "已完成",
};

export function createDefaultTodoDraft(): TodoDraft {
  return {
    title: "",
    urgency: "medium",
    plannedSeconds: 25 * 60,
    countdownEnabled: false,
    reminderEnabled: false,
    reminderTime: getDefaultReminderTime(),
    recordTimeEnabled: true,
  };
}

export function TodoEditorForm({
  initialDraft,
  status,
  title,
  titleIcon,
  submitLabel,
  className,
  autoFocus = false,
  onSubmit,
  onCancel,
}: TodoEditorFormProps) {
  const [draft, setDraft] = useState<TodoDraft>(initialDraft);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerPosition, setTimePickerPosition] =
    useState<CSSProperties | null>(null);
  const reminderTimeRef = useRef<HTMLDivElement | null>(null);
  const reminderTimeButtonRef = useRef<HTMLButtonElement | null>(null);
  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);
  const trimmedTitle = draft.title.trim();
  const reminderTimeValue =
    normalizeReminderTime(draft.reminderTime) ?? getDefaultReminderTime();
  const [selectedHour, selectedMinute] = reminderTimeValue.split(":");

  const updateDraft = <K extends keyof TodoDraft>(
    key: K,
    value: TodoDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleReminderToggle = (enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      reminderEnabled: enabled,
      reminderTime: enabled
        ? normalizeReminderTime(current.reminderTime) ?? getDefaultReminderTime()
        : current.reminderTime,
    }));
  };

  const toggleReminderTimePicker = () => {
    if (!draft.reminderEnabled) return;
    if (timePickerOpen) {
      setTimePickerOpen(false);
      return;
    }

    updateTimePickerPosition();
    setTimePickerOpen(true);
  };

  const updateTimePickerPosition = () => {
    const button = reminderTimeButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      Math.max(TIME_PICKER_VIEWPORT_PADDING, rect.left),
      Math.max(
        TIME_PICKER_VIEWPORT_PADDING,
        viewportWidth - TIME_PICKER_POPOVER_WIDTH - TIME_PICKER_VIEWPORT_PADDING,
      ),
    );
    const hasRoomBelow =
      rect.bottom + TIME_PICKER_POPOVER_GAP + TIME_PICKER_POPOVER_HEIGHT <=
      viewportHeight - TIME_PICKER_VIEWPORT_PADDING;
    const rawTop = hasRoomBelow
      ? rect.bottom + TIME_PICKER_POPOVER_GAP
      : rect.top - TIME_PICKER_POPOVER_HEIGHT - TIME_PICKER_POPOVER_GAP;
    const top = Math.min(
      Math.max(TIME_PICKER_VIEWPORT_PADDING, rawTop),
      Math.max(
        TIME_PICKER_VIEWPORT_PADDING,
        viewportHeight -
          TIME_PICKER_POPOVER_HEIGHT -
          TIME_PICKER_VIEWPORT_PADDING,
      ),
    );

    setTimePickerPosition({ left, top });
  };

  const updateReminderTimePart = (part: "hour" | "minute", value: string) => {
    const nextTime =
      part === "hour"
        ? `${value}:${selectedMinute}`
        : `${selectedHour}:${value}`;
    updateDraft("reminderTime", nextTime);
  };

  useEffect(() => {
    if (!timePickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        reminderTimeRef.current?.contains(target)
      ) {
        return;
      }
      setTimePickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimePickerOpen(false);
    };

    const handleViewportChange = (event?: Event) => {
      const target = event?.target;
      if (
        target instanceof Node &&
        reminderTimeRef.current?.contains(target)
      ) {
        return;
      }
      updateTimePickerPosition();
    };

    updateTimePickerPosition();
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
  }, [timePickerOpen]);

  useEffect(() => {
    if (!timePickerOpen) return;
    window.requestAnimationFrame(() => {
      centerTimePickerList(hourListRef.current, Number(selectedHour));
      centerTimePickerList(minuteListRef.current, Number(selectedMinute));
    });
  }, [selectedHour, selectedMinute, timePickerOpen]);

  useEffect(() => {
    if (!timePickerOpen) return;

    const lists = [hourListRef.current, minuteListRef.current].filter(
      (list): list is HTMLDivElement => list !== null,
    );
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const list = event.currentTarget;
      if (!(list instanceof HTMLDivElement)) return;
      const verticalDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      list.scrollTop += verticalDelta;
    };

    lists.forEach((list) =>
      list.addEventListener("wheel", handleWheel, { passive: false }),
    );
    return () => {
      lists.forEach((list) => list.removeEventListener("wheel", handleWheel));
    };
  }, [timePickerOpen]);

  const centerTimePickerList = (
    list: HTMLDivElement | null,
    selectedIndex: number,
  ) => {
    if (!list) return;
    const targetTop =
      selectedIndex * TIME_PICKER_OPTION_STEP -
      (list.clientHeight - TIME_PICKER_OPTION_STEP) / 2;
    list.scrollTop = Math.max(0, targetTop);
  };

  const handleTimePickerListWheel = (
    event: WheelEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const verticalDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    event.currentTarget.scrollTop += verticalDelta;
  };

  const scrollTimePickerList = (
    list: HTMLDivElement | null,
    direction: -1 | 1,
  ) => {
    if (!list) return;
    list.scrollBy({
      top: direction * TIME_PICKER_OPTION_STEP * 4,
      behavior: "smooth",
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedTitle) return;
    onSubmit({
      ...draft,
      title: trimmedTitle,
      reminderTime: draft.reminderEnabled
        ? normalizeReminderTime(draft.reminderTime)
        : null,
    });
  };

  return (
    <form className={className} onSubmit={handleSubmit}>
      <div className="todo-form__header">
        <h2>
          {titleIcon}
          {title}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          <IconClose size={16} />
          取消
        </button>
      </div>

      <label className="field">
        <span className="field__label">任务内容</span>
        <input
          className="field__input"
          value={draft.title}
          onChange={(event) => updateDraft("title", event.target.value)}
          placeholder="今天要完成什么？"
          autoFocus={autoFocus}
          maxLength={120}
        />
      </label>

      <div className="todo-form__meta-row">
        <div className="field field--urgency">
          <span className="field__label">
            <IconFlag size={14} />
            紧急程度
          </span>
          <div className="urgency-group" role="group" aria-label="紧急程度">
            {URGENCIES.map((urgency) => (
              <button
                key={urgency}
                type="button"
                className={`urgency-chip urgency-chip--${urgency} ${
                  draft.urgency === urgency ? "is-active" : ""
                }`}
                onClick={() => updateDraft("urgency", urgency)}
              >
                {urgency === "critical" ? (
                  <IconFlame size={14} />
                ) : (
                  <IconFlag size={14} />
                )}
                {URGENCY_LABELS[urgency]}
              </button>
            ))}
          </div>
        </div>

        <div className="field field--timer">
          <div className="field__label-row">
            <span className="field__label">
              <IconClock size={14} />
              倒计时
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                checked={draft.countdownEnabled}
                onChange={(event) =>
                  updateDraft("countdownEnabled", event.currentTarget.checked)
                }
              />
              <span className="switch-control__track" aria-hidden />
              <span className="switch-control__text">
                {draft.countdownEnabled ? "已开启" : "关闭"}
              </span>
            </label>
          </div>
          <CountdownDial
            value={draft.plannedSeconds}
            disabled={!draft.countdownEnabled}
            onChange={(seconds) => updateDraft("plannedSeconds", seconds)}
          />
        </div>
      </div>

      <div
        className={`preset-row ${draft.countdownEnabled ? "" : "is-disabled"}`}
        aria-label="预设时长"
      >
        {PRESET_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`preset-chip ${
              draft.countdownEnabled && draft.plannedSeconds === minutes * 60
                ? "is-active"
                : ""
            }`}
            disabled={!draft.countdownEnabled}
            onClick={() => updateDraft("plannedSeconds", minutes * 60)}
          >
            {minutes < 60 ? `${minutes}分` : `${minutes / 60}小时`}
          </button>
        ))}
      </div>

      <div className="todo-reminder-row">
        <div className="field field--reminder" aria-label="提醒设置">
          <div className="field__label-row">
            <span className="field__label">
              <IconBell size={14} />
              提醒
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                checked={draft.reminderEnabled}
                onChange={(event) =>
                  handleReminderToggle(event.currentTarget.checked)
                }
              />
              <span className="switch-control__track" aria-hidden />
              <span className="switch-control__text">
                {draft.reminderEnabled ? "已开启" : "关闭"}
              </span>
            </label>
          </div>
          <div
            ref={reminderTimeRef}
            className={`field todo-reminder-time ${
              draft.reminderEnabled ? "" : "is-disabled"
            }`}
          >
            <span className="field__label">提醒时间</span>
            <button
              ref={reminderTimeButtonRef}
              type="button"
              className="todo-reminder-time__control"
              disabled={!draft.reminderEnabled}
              onClick={toggleReminderTimePicker}
              aria-haspopup="listbox"
              aria-expanded={timePickerOpen}
            >
              <IconClock size={14} />
              <span className="todo-reminder-time__value">
                {reminderTimeValue}
              </span>
            </button>
            {timePickerOpen && (
              <div
                className="time-picker-popover"
                role="dialog"
                style={timePickerPosition ?? undefined}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
              >
                <div className="time-picker-popover__column">
                  <span className="time-picker-popover__label">时</span>
                  <button
                    type="button"
                    className="time-picker-popover__scroll-btn"
                    aria-label="向上滚动小时"
                    onClick={() => scrollTimePickerList(hourListRef.current, -1)}
                  >
                    <IconChevronUp size={12} />
                  </button>
                  <div
                    ref={hourListRef}
                    className="time-picker-popover__list"
                    role="listbox"
                    aria-label="选择小时"
                    onWheelCapture={handleTimePickerListWheel}
                    onWheel={handleTimePickerListWheel}
                  >
                    {HOURS.map((hour) => (
                      <button
                        key={hour}
                        type="button"
                        className={`time-picker-popover__option ${
                          selectedHour === hour ? "is-active" : ""
                        }`}
                        role="option"
                        aria-selected={selectedHour === hour}
                        onClick={() => updateReminderTimePart("hour", hour)}
                      >
                        {hour}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="time-picker-popover__scroll-btn"
                    aria-label="向下滚动小时"
                    onClick={() => scrollTimePickerList(hourListRef.current, 1)}
                  >
                    <IconChevronDown size={12} />
                  </button>
                </div>
                <div className="time-picker-popover__column">
                  <span className="time-picker-popover__label">分</span>
                  <button
                    type="button"
                    className="time-picker-popover__scroll-btn"
                    aria-label="向上滚动分钟"
                    onClick={() =>
                      scrollTimePickerList(minuteListRef.current, -1)
                    }
                  >
                    <IconChevronUp size={12} />
                  </button>
                  <div
                    ref={minuteListRef}
                    className="time-picker-popover__list"
                    role="listbox"
                    aria-label="选择分钟"
                    onWheelCapture={handleTimePickerListWheel}
                    onWheel={handleTimePickerListWheel}
                  >
                    {MINUTES.map((minute) => (
                      <button
                        key={minute}
                        type="button"
                        className={`time-picker-popover__option ${
                          selectedMinute === minute ? "is-active" : ""
                        }`}
                        role="option"
                        aria-selected={selectedMinute === minute}
                        onClick={() =>
                          updateReminderTimePart("minute", minute)
                        }
                      >
                        {minute}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="time-picker-popover__scroll-btn"
                    aria-label="向下滚动分钟"
                    onClick={() =>
                      scrollTimePickerList(minuteListRef.current, 1)
                    }
                  >
                    <IconChevronDown size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="field field--record-time" aria-label="记录时间设置">
          <div className="field__label-row">
            <span className="field__label">
              <IconClockHour4 size={14} />
              记录时间
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                checked={draft.recordTimeEnabled}
                onChange={(event) =>
                  updateDraft("recordTimeEnabled", event.currentTarget.checked)
                }
              />
              <span className="switch-control__track" aria-hidden />
              <span className="switch-control__text">
                {draft.recordTimeEnabled ? "已开启" : "关闭"}
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="todo-status-panel" aria-label="待办完成情况">
        <span className="todo-status-panel__label">待办完成情况</span>
        <div className="todo-status-panel__chips">
          {(Object.keys(STATUS_LABELS) as TodoStatus[]).map((state) => (
            <span
              key={state}
              className={`todo-status-chip ${
                status === state ? "is-active" : ""
              }`}
            >
              {STATUS_LABELS[state]}
            </span>
          ))}
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-block btn-add-submit"
        disabled={!trimmedTitle}
      >
        <IconCheck size={16} />
        {submitLabel}
      </button>
    </form>
  );
}
