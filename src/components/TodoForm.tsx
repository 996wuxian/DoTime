import { FormEvent, useState } from "react";
import type { Urgency } from "../types";
import { URGENCY_LABELS } from "../types";
import { CountdownDial } from "./CountdownDial";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconFlag,
  IconFlame,
  IconPlus,
} from "./icons";
import { PRESET_MINUTES } from "../utils/time";

interface TodoFormProps {
  onAdd: (title: string, urgency: Urgency, plannedSeconds: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];

export function TodoForm({ onAdd, open, onOpenChange }: TodoFormProps) {
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("medium");
  const [plannedSeconds, setPlannedSeconds] = useState(25 * 60);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title, urgency, plannedSeconds);
    setTitle("");
    setUrgency("medium");
    setPlannedSeconds(25 * 60);
    onOpenChange(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary btn-add-open"
        onClick={() => onOpenChange(true)}
      >
        <IconPlus size={18} />
        新建待办
      </button>
    );
  }

  return (
    <form className="todo-form card" onSubmit={handleSubmit}>
      <div className="todo-form__header">
        <h2>
          <IconPlus size={18} />
          新建待办
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onOpenChange(false)}
        >
          <IconClose size={16} />
          取消
        </button>
      </div>

      <label className="field">
        <span className="field__label">任务内容</span>
        <input
          className="field__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="今天要完成什么？"
          autoFocus
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
            {URGENCIES.map((u) => (
              <button
                key={u}
                type="button"
                className={`urgency-chip urgency-chip--${u} ${
                  urgency === u ? "is-active" : ""
                }`}
                onClick={() => setUrgency(u)}
              >
                {u === "critical" ? (
                  <IconFlame size={14} />
                ) : (
                  <IconFlag size={14} />
                )}
                {URGENCY_LABELS[u]}
              </button>
            ))}
          </div>
        </div>

        <div className="field field--timer">
          <span className="field__label">
            <IconClock size={14} />
            倒计时
          </span>
          <CountdownDial value={plannedSeconds} onChange={setPlannedSeconds} />
        </div>
      </div>

      <div className="preset-row" aria-label="预设时长">
        {PRESET_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            className={`preset-chip ${
              plannedSeconds === m * 60 ? "is-active" : ""
            }`}
            onClick={() => setPlannedSeconds(m * 60)}
          >
            {m < 60 ? `${m}分` : `${m / 60}小时`}
          </button>
        ))}
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-block btn-add-submit"
        disabled={!title.trim()}
      >
        <IconCheck size={16} />
        添加待办
      </button>
    </form>
  );
}
