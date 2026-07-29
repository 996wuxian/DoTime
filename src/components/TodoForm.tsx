import type { Urgency } from "../types";
import type { RecurrenceRule } from "../types";
import type { TodoDateSummary } from "../types";
import {
  createDefaultTodoDraft,
  TodoEditorForm,
} from "./TodoEditorForm";
import type { TodoDraft } from "./TodoEditorForm";
import { IconPlus } from "./icons";

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
}

export function TodoForm({
  onAdd,
  open,
  selectedDate,
  todoDateSummaries,
  onOpenChange,
}: TodoFormProps) {
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

  return (
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
    />
  );
}
