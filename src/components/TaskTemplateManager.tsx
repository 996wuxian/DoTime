import { useEffect, useState } from "react";
import type { TaskTemplate } from "../types";
import { RECURRENCE_LABELS, URGENCY_LABELS } from "../types";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconPencil,
  IconTrash,
} from "./icons";

interface TaskTemplateManagerProps {
  templates: readonly TaskTemplate[];
  notice: string | null;
  onRename: (id: string, name: string) => boolean;
  onRemove: (id: string) => boolean;
  onMove: (id: string, direction: -1 | 1) => boolean;
  onClose: () => void;
}

function getTemplateTags(template: TaskTemplate): string[] {
  const parts = [`紧急 ${URGENCY_LABELS[template.urgency]}`];
  parts.push(template.countdownEnabled ? "计时开启" : "计时关闭");
  parts.push(
    template.reminderEnabled && template.reminderTime
      ? `提醒 ${template.reminderTime}`
      : "提醒关闭",
  );
  parts.push(template.recordTimeEnabled ? "记录开启" : "记录关闭");
  if (template.recurrence) {
    parts.push(`重复 ${RECURRENCE_LABELS[template.recurrence.frequency]}`);
  }
  return parts;
}

function shouldShowTemplateTask(template: TaskTemplate): boolean {
  return template.title.trim() !== template.name.trim();
}

export function TaskTemplateManager({
  templates,
  notice,
  onRename,
  onRemove,
  onMove,
  onClose,
}: TaskTemplateManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editingId) {
        setEditingId(null);
        return;
      }
      if (pendingDeleteId) {
        setPendingDeleteId(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingId, onClose, pendingDeleteId]);

  const saveRename = () => {
    if (!editingId || !editingName.trim()) return;
    if (onRename(editingId, editingName)) setEditingId(null);
  };

  return (
    <div
      className="task-template-manager-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="task-template-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-template-manager-title"
      >
        <header>
          <div>
            <h2 id="task-template-manager-title">管理任务模板</h2>
            <span>{templates.length} 个模板</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            onClick={onClose}
            aria-label="关闭模板管理"
            title="关闭"
          >
            <IconClose size={16} />
          </button>
        </header>

        <div className="task-template-manager__body">
          {templates.length === 0 ? (
            <div className="task-template-manager__empty">暂无任务模板</div>
          ) : (
            <ol className="task-template-manager__list">
              {templates.map((template, index) => (
                <li key={template.id}>
                  <span className="task-template-manager__index">{index + 1}</span>
                  <div className="task-template-manager__main">
                    {editingId === template.id ? (
                      <input
                        value={editingName}
                        maxLength={40}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          saveRename();
                        }}
                        aria-label={`重命名 ${template.name}`}
                      />
                    ) : (
                      <strong>{template.name}</strong>
                    )}
                    {shouldShowTemplateTask(template) && (
                      <span className="task-template-manager__task">{template.title}</span>
                    )}
                    <span className="task-template-manager__tags" aria-label="模板设置">
                      {getTemplateTags(template).map((tag) => (
                        <small key={tag}>{tag}</small>
                      ))}
                    </span>
                  </div>

                  {pendingDeleteId === template.id ? (
                    <div className="task-template-manager__confirm">
                      <span>确认删除？</span>
                      <button type="button" onClick={() => setPendingDeleteId(null)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          if (onRemove(template.id)) setPendingDeleteId(null);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : editingId === template.id ? (
                    <div className="task-template-manager__actions">
                      <button
                        type="button"
                        onClick={saveRename}
                        disabled={!editingName.trim()}
                        aria-label="保存模板名称"
                        title="保存"
                      >
                        <IconCheck size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="取消重命名"
                        title="取消"
                      >
                        <IconClose size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="task-template-manager__actions">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => onMove(template.id, -1)}
                        aria-label={`上移 ${template.name}`}
                        title="上移"
                      >
                        <IconChevronUp size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={index === templates.length - 1}
                        onClick={() => onMove(template.id, 1)}
                        aria-label={`下移 ${template.name}`}
                        title="下移"
                      >
                        <IconChevronDown size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(template.id);
                          setEditingName(template.name);
                        }}
                        aria-label={`重命名 ${template.name}`}
                        title="重命名"
                      >
                        <IconPencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => setPendingDeleteId(template.id)}
                        aria-label={`删除 ${template.name}`}
                        title="删除"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        {notice && <p className="task-template-manager__notice" role="status">{notice}</p>}
      </section>
    </div>
  );
}
