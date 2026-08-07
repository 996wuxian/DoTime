import type { TodoImage } from "../types";
import type { Todo } from "../types";

export const MAX_TODO_IMAGES = 3;
const MAX_IMAGE_EDGE = 1440;

function createImageId(): string {
  return `todo-image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片文件。"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析图片文件。"));
    image.src = dataUrl;
  });
}

async function maybeResizeImage(file: File, dataUrl: string): Promise<string> {
  if (file.type === "image/gif") return dataUrl;

  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const longestEdge = Math.max(width, height);
  if (longestEdge <= MAX_IMAGE_EDGE) return dataUrl;

  const scale = MAX_IMAGE_EDGE / longestEdge;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.9);
}

export async function createTodoImageFromFile(file: File): Promise<TodoImage> {
  const dataUrl = await readFileAsDataUrl(file);
  const normalized = await maybeResizeImage(file, dataUrl);
  const mimeType = normalized === dataUrl ? file.type : "image/webp";
  return {
    id: createImageId(),
    name: file.name,
    mimeType,
    dataUrl: normalized,
  };
}

export function getTodoImagesSignature(
  images: readonly TodoImage[] = [],
): string {
  return images
    .slice(0, MAX_TODO_IMAGES)
    .map(
      (image) =>
        [
          image.id,
          image.name,
          image.mimeType ?? "",
          image.fileName ?? "",
          image.dataUrl ? "data" : "",
        ].join(":"),
    )
    .join("|");
}

export async function persistTodoImages(
  todoId: string,
  images: readonly TodoImage[] = [],
): Promise<TodoImage[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TodoImage[]>("persist_todo_images", {
    todoId,
    images: images.slice(0, MAX_TODO_IMAGES),
  });
}

export async function removeTodoImages(todoId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_todo_images", { todoId });
}

export type TodoImageCleanupResult = {
  removedDirs: number;
  removedFiles: number;
  failedDirs: number;
  failedFiles: number;
};

export async function cleanupTodoImages(
  todos: readonly Todo[],
): Promise<TodoImageCleanupResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TodoImageCleanupResult>("cleanup_todo_images", {
    references: todos.map((todo) => ({
      todoId: todo.id,
      fileNames: (todo.images ?? [])
        .map((image) => image.fileName)
        .filter((fileName): fileName is string => Boolean(fileName)),
    })),
  });
}
