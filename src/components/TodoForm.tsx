import type { Urgency } from "../types";
import {
  DEFAULT_TODO_DRAFT,
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
  ) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TodoForm({ onAdd, open, onOpenChange }: TodoFormProps) {
  const handleSubmit = (draft: TodoDraft) => {
    onAdd(
      draft.title,
      draft.urgency,
      draft.plannedSeconds,
      draft.countdownEnabled,
    );
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <TodoEditorForm
      initialDraft={DEFAULT_TODO_DRAFT}
      status="idle"
      title="新建待办"
      titleIcon={<IconPlus size={18} />}
      submitLabel="添加待办"
      className="todo-form card"
      autoFocus
      onSubmit={handleSubmit}
      onCancel={() => onOpenChange(false)}
    />
  );
}
