import { useState } from "react";
import type { TodoDateSummary } from "../types";
import type { TaskTemplate } from "../types";
import type { TaskTemplateInput } from "../data/taskTemplates";
import { TodoEditorForm } from "./TodoEditorForm";
import { createDefaultTodoDraft, parseSubtaskTitles } from "../utils/todoDraft";
import type { TodoDraft } from "./TodoEditorForm";
import { IconPlus } from "./icons";
import { TaskTemplateManager } from "./TaskTemplateManager";

interface TodoFormProps {
  onAdd: (draft: TodoDraft) => void;
  open: boolean;
  selectedDate: string;
  todoDateSummaries: ReadonlyMap<string, TodoDateSummary>;
  onOpenChange: (open: boolean) => void;
  templates: readonly TaskTemplate[];
  templateNotice: string | null;
  onAddTemplate: (input: TaskTemplateInput) => TaskTemplate | null;
  onRenameTemplate: (id: string, name: string) => boolean;
  onRemoveTemplate: (id: string) => boolean;
  onMoveTemplate: (id: string, direction: -1 | 1) => boolean;
}

export function TodoForm({
  onAdd,
  open,
  selectedDate,
  todoDateSummaries,
  onOpenChange,
  templates,
  templateNotice,
  onAddTemplate,
  onRenameTemplate,
  onRemoveTemplate,
  onMoveTemplate,
}: TodoFormProps) {
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const handleSubmit = (draft: TodoDraft) => {
    onAdd(draft);
    onOpenChange(false);
  };

  if (!open) return null;

  const handleSaveTemplate = (
    draft: TodoDraft,
    name: string,
    includeRecurrence: boolean,
  ) =>
    onAddTemplate({
      name,
      title: draft.title,
      urgency: draft.urgency,
      plannedSeconds: draft.plannedSeconds,
      countdownEnabled: draft.countdownEnabled,
      countdownOnlyEnabled: draft.countdownOnlyEnabled,
      reminderEnabled: draft.reminderEnabled,
      reminderTime: draft.reminderTime,
      recordTimeEnabled: draft.recordTimeEnabled,
      recurrence: includeRecurrence ? draft.recurrence : null,
      taskTime: draft.taskTime,
      comment: draft.comment,
      // 模板不保存图片，避免把临时素材带进复用模板。
      subtasks: parseSubtaskTitles(draft.subtaskTitles).map((title) => ({
        title,
        urgency: "medium",
        plannedSeconds: 25 * 60,
        countdownEnabled: false,
        recordTimeEnabled: false,
      })),
    });

  return (
    <>
      <TodoEditorForm
        draftKey={`new:${selectedDate}`}
        initialDraft={createDefaultTodoDraft(selectedDate)}
        title="新建待办"
        titleIcon={<IconPlus size={18} />}
        submitLabel="添加待办"
        className="todo-form card"
        autoFocus
        onSubmit={handleSubmit}
        onSubmitAndContinue={onAdd}
        onCancel={() => onOpenChange(false)}
        todoDateSummaries={todoDateSummaries}
        templates={templates}
        templateNotice={templateNotice}
        onSaveTemplate={handleSaveTemplate}
        onManageTemplates={() => setTemplateManagerOpen(true)}
      />
      {templateManagerOpen && (
        <TaskTemplateManager
          templates={templates}
          notice={templateNotice}
          onRename={onRenameTemplate}
          onRemove={onRemoveTemplate}
          onMove={onMoveTemplate}
          onClose={() => setTemplateManagerOpen(false)}
        />
      )}
    </>
  );
}
