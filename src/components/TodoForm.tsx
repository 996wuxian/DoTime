import { useState } from "react";
import type { Urgency } from "../types";
import type { RecurrenceRule } from "../types";
import type { TodoDateSummary } from "../types";
import type { TaskTemplate } from "../types";
import type { TaskTemplateInput } from "../data/taskTemplates";
import {
  createDefaultTodoDraft,
  TodoEditorForm,
} from "./TodoEditorForm";
import type { TodoDraft } from "./TodoEditorForm";
import { IconPlus } from "./icons";
import { TaskTemplateManager } from "./TaskTemplateManager";

interface TodoFormProps {
  onAdd: (
    title: string,
    urgency: Urgency,
    plannedSeconds: number,
    countdownEnabled: boolean,
    reminderEnabled: boolean,
    reminderTime: string | null,
    recordTimeEnabled: boolean,
    date?: string,
    recurrence?: RecurrenceRule | null,
  ) => void;
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
    onAdd(
      draft.title,
      draft.urgency,
      draft.plannedSeconds,
      draft.countdownEnabled,
      draft.reminderEnabled,
      draft.reminderTime,
      draft.recordTimeEnabled,
      draft.date,
      draft.recurrence,
    );
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
      reminderEnabled: draft.reminderEnabled,
      reminderTime: draft.reminderTime,
      recordTimeEnabled: draft.recordTimeEnabled,
      recurrence: includeRecurrence ? draft.recurrence : null,
    });

  return (
    <>
      <TodoEditorForm
        initialDraft={createDefaultTodoDraft(selectedDate)}
        status="idle"
        title="新建待办"
        titleIcon={<IconPlus size={18} />}
        submitLabel="添加待办"
        className="todo-form card"
        autoFocus
        onSubmit={handleSubmit}
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
