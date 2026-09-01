import { useEffect, useState } from "react";
import type { TodoImage } from "../types";

export function useTodoImageSrc(
  todoId: string | null | undefined,
  image: TodoImage,
): string | null {
  const [src, setSrc] = useState<string | null>(() => image.dataUrl ?? null);

  useEffect(() => {
    let cancelled = false;

    if (image.dataUrl) {
      setSrc(image.dataUrl);
      return () => {
        cancelled = true;
      };
    }

    if (!todoId || !image.fileName) {
      setSrc(null);
      return () => {
        cancelled = true;
      };
    }
    const fileName = image.fileName;
    const currentTodoId = todoId;

    setSrc(null);
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const dataUrl = await invoke<string>("read_todo_image", {
          todoId: currentTodoId,
          fileName,
        });
        if (!cancelled) setSrc(dataUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [image.dataUrl, image.fileName, todoId]);

  return src;
}
