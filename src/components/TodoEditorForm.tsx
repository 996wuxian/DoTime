import { FormEvent, useState } from "react";
import type { ReactNode } from "react";
import type { Urgency } from "../types";
import { URGENCY_LABELS } from "../types";
import { PRESET_MINUTES } from "../utils/time";
import { CountdownDial } from "./CountdownDial";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconFlag,
  IconFlame,
} from "./icons";

export type TodoStatus = "idle" | "active" | "done";

export interface TodoDraft {
  title: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
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

const STATUS_LABELS: Record<TodoStatus, string> = {
  idle: "待开始",
  active: "进行中",
  done: "已完成",
};

export const DEFAULT_TODO_DRAFT: TodoDraft = {
  title: "",
  urgency: "medium",
  plannedSeconds: 25 * 60,
  countdownEnabled: false,
};

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
  const trimmedTitle = draft.title.trim();

  const updateDraft = <K extends keyof TodoDraft>(
    key: K,
    value: TodoDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedTitle) return;
    onSubmit({ ...draft, title: trimmedTitle });
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
