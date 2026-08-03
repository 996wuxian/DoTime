import { useEffect, useRef, useState } from "react";
import type { TaskTemplate } from "../types";
import { RECURRENCE_LABELS, URGENCY_LABELS } from "../types";
import { formatDurationHuman } from "../utils/time";
import type { TodoDraft } from "./TodoEditorForm";
import {
  IconBookmark,
  IconChevronDown,
  IconClose,
  IconDeviceFloppy,
  IconSettings,
} from "./icons";

interface TaskTemplateControlsProps {
  templates: readonly TaskTemplate[];
  draft: TodoDraft;
  notice: string | null;
  compact?: boolean;
  onApply: (template: TaskTemplate) => void;
  onSave: (name: string, includeRecurrence: boolean) => TaskTemplate | null;
  onManage: () => void;
}

function getTemplateDetails(template: TaskTemplate) {
  return [
    { label: "紧急", value: URGENCY_LABELS[template.urgency] },
    template.countdownEnabled
      ? { label: "计时", value: formatDurationHuman(template.plannedSeconds) }
      : { label: "计时", value: "关闭" },
    template.reminderEnabled && template.reminderTime
      ? { label: "提醒", value: template.reminderTime }
      : { label: "提醒", value: "关闭" },
    { label: "记录", value: template.recordTimeEnabled ? "开启" : "关闭" },
    template.recurrence
      ? { label: "重复", value: RECURRENCE_LABELS[template.recurrence.frequency] }
      : null,
  ].filter((detail): detail is { label: string; value: string } => detail != null);
}

function shouldShowTemplateTitle(template: TaskTemplate) {
  return template.title.trim() !== template.name.trim();
}

export function TaskTemplateControls({
  templates,
  draft,
  notice,
  compact = false,
  onApply,
  onSave,
  onManage,
}: TaskTemplateControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [includeRecurrence, setIncludeRecurrence] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTemplate = templates.find((template) => template.id === selectedId);
  const canSave = draft.title.trim().length > 0;

  useEffect(() => {
    if (!menuOpen && !saveOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setSaveOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSaveOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, saveOpen]);

  useEffect(() => {
    if (!saveOpen) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [saveOpen]);

  const openSave = () => {
    if (!canSave) return;
    setTemplateName(draft.title.trim().slice(0, 40));
    setIncludeRecurrence(draft.recurrence != null);
    setMenuOpen(false);
    setSaveOpen(true);
  };

  const saveTemplate = () => {
    const created = onSave(templateName, includeRecurrence);
    if (!created) return;
    setSelectedId(created.id);
    setSaveOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`task-template-controls ${
        compact ? "task-template-controls--compact" : ""
      }`}
    >
      <div className="task-template-controls__row">
        <span className="task-template-controls__label">
          <IconBookmark size={14} />
          模板选择：
        </span>
        <div className="task-template-select">
          <button
            type="button"
            className="task-template-select__trigger"
            disabled={templates.length === 0}
            onClick={() => {
              setMenuOpen((open) => !open);
              setSaveOpen(false);
            }}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
          >
            <span>{selectedTemplate?.name ?? (templates.length ? "选择模板" : "暂无模板")}</span>
            <IconChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="task-template-select__menu" role="listbox" aria-label="选择任务模板">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={template.id === selectedId ? "is-active" : ""}
                  role="option"
                  aria-selected={template.id === selectedId}
                  onClick={() => {
                    setSelectedId(template.id);
                    setMenuOpen(false);
                    onApply(template);
                  }}
                >
                  <span className="task-template-select__item-main">
                    <strong>{template.name}</strong>
                    {shouldShowTemplateTitle(template) && (
                      <span className="task-template-select__task">
                        <b>任务</b>
                        <span>{template.title}</span>
                      </span>
                    )}
                  </span>
                  <span className="task-template-select__details">
                    {getTemplateDetails(template).map((detail) => (
                      <small key={detail.label}>
                        <b>{detail.label}</b>
                        <span>{detail.value}</span>
                      </small>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only task-template-controls__action"
          disabled={!canSave}
          onClick={openSave}
          aria-label="保存为任务模板"
          title="保存为任务模板"
        >
          <IconDeviceFloppy size={16} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon-only task-template-controls__action"
          onClick={onManage}
          aria-label="管理任务模板"
          title="管理任务模板"
        >
          <IconSettings size={16} />
        </button>
      </div>

      {saveOpen && (
        <div className="task-template-save" role="dialog" aria-label="保存任务模板">
          <div className="task-template-save__header">
            <strong>保存任务模板</strong>
            <button
              type="button"
              onClick={() => setSaveOpen(false)}
              aria-label="取消保存模板"
              title="取消"
            >
              <IconClose size={14} />
            </button>
          </div>
          <label>
            <span>模板名称</span>
            <input
              ref={nameInputRef}
              value={templateName}
              maxLength={40}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                saveTemplate();
              }}
            />
          </label>
          <label className="task-template-save__recurrence">
            <input
              type="checkbox"
              checked={includeRecurrence && draft.recurrence != null}
              disabled={draft.recurrence == null}
              onChange={(event) => setIncludeRecurrence(event.currentTarget.checked)}
            />
            <span>保存重复规则（不含结束日期）</span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!templateName.trim()}
            onClick={saveTemplate}
          >
            <IconDeviceFloppy size={14} />
            保存模板
          </button>
        </div>
      )}

      {notice && <p className="task-template-controls__notice" role="status">{notice}</p>}
    </div>
  );
}
