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
        const [{ convertFileSrc }, { appDataDir, join }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/path"),
        ]);
        const imagePath = await join(
          await appDataDir(),
          "todo-images",
          currentTodoId,
          fileName,
        );
        if (!cancelled) setSrc(convertFileSrc(imagePath));
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
