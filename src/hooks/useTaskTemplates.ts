import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskTemplate } from "../types";
import {
  TASK_TEMPLATE_STORAGE_KEY,
  createTaskTemplate,
  loadTaskTemplates,
  saveTaskTemplates,
  type TaskTemplateInput,
} from "../data/taskTemplates";

type TemplateMoveDirection = -1 | 1;

function normalizeOrder(templates: readonly TaskTemplate[]): TaskTemplate[] {
  return templates.map((template, index) => ({
    ...template,
    sortOrder: (index + 1) * 1000,
  }));
}

export function useTaskTemplates() {
  const initialRef = useRef<ReturnType<typeof loadTaskTemplates> | null>(null);
  if (initialRef.current == null) {
    initialRef.current = loadTaskTemplates(localStorage);
  }
  const initial = initialRef.current;
  const [templates, setTemplates] = useState<TaskTemplate[]>(initial.templates);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const templatesRef = useRef(templates);

  const commit = useCallback(
    (nextTemplates: TaskTemplate[], successMessage: string): boolean => {
      const normalized = normalizeOrder(nextTemplates);
      const result = saveTaskTemplates(normalized, localStorage);
      if (!result.ok) {
        setNotice(`模板保存失败：${result.error}`);
        return false;
      }
      templatesRef.current = normalized;
      setTemplates(normalized);
      setNotice(successMessage);
      return true;
    },
    [],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TASK_TEMPLATE_STORAGE_KEY) return;
      const loaded = loadTaskTemplates(localStorage);
      templatesRef.current = loaded.templates;
      setTemplates(loaded.templates);
      if (loaded.notice) setNotice(loaded.notice);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const addTemplate = useCallback(
    (input: TaskTemplateInput): TaskTemplate | null => {
      if (!input.name.trim() || !input.title.trim()) return null;
      const current = templatesRef.current;
      const lastSortOrder = current[current.length - 1]?.sortOrder ?? 0;
      const template = createTaskTemplate(input, lastSortOrder + 1000);
      return commit([...current, template], `已保存模板「${template.name}」。`)
        ? template
        : null;
    },
    [commit],
  );

  const renameTemplate = useCallback(
    (id: string, name: string): boolean => {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return false;
      const current = templatesRef.current;
      const target = current.find((template) => template.id === id);
      if (!target) return false;
      return commit(
        current.map((template) =>
          template.id === id
            ? { ...template, name: trimmed, updatedAt: Date.now() }
            : template,
        ),
        `已重命名模板为「${trimmed}」。`,
      );
    },
    [commit],
  );

  const removeTemplate = useCallback(
    (id: string): boolean => {
      const current = templatesRef.current;
      const target = current.find((template) => template.id === id);
      if (!target) return false;
      return commit(
        current.filter((template) => template.id !== id),
        `已删除模板「${target.name}」。`,
      );
    },
    [commit],
  );

  const moveTemplate = useCallback(
    (id: string, direction: TemplateMoveDirection): boolean => {
      const current = templatesRef.current;
      const index = current.findIndex((template) => template.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return false;
      }
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return commit(next, "已更新模板顺序。");
    },
    [commit],
  );

  return {
    templates,
    notice,
    addTemplate,
    renameTemplate,
    removeTemplate,
    moveTemplate,
  };
}
