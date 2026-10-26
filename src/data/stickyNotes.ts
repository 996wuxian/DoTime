import { invoke, isTauri } from "@tauri-apps/api/core";
import { notePreview } from "../utils/stickyNoteEditor";

export const NOTE_COLORS = [
  { id: "yellow", label: "暖黄" },
  { id: "green", label: "浅绿" },
  { id: "pink", label: "浅粉" },
  { id: "purple", label: "淡紫" },
  { id: "blue", label: "浅蓝" },
  { id: "gray", label: "浅灰" },
  { id: "dark", label: "深色" },
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]["id"];

export type StickyNote = {
  id: string;
  html: string;
  text?: string;
  color: NoteColor;
  pinned: boolean;
  open: boolean;
  createdAt: number;
  updatedAt: number;
};

export type StickyNoteSummary = Omit<StickyNote, "html" | "text"> & { text: string };
export type NotePatch = Partial<Pick<StickyNote, "html" | "text" | "color" | "pinned">>;
export const STICKY_NOTES_CHANGED_EVENT = "dotime-sticky-notes-changed";
const BROWSER_STORAGE_KEY = "dotime-sticky-notes-v1";

function loadBrowserNotes(): StickyNote[] {
  const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
  if (raw == null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((item: unknown) => {
    if (item == null || typeof item !== "object") return false;
    const note = item as Record<string, unknown>;
    return typeof note.id === "string" && typeof note.html === "string"
      && NOTE_COLORS.some((color) => color.id === note.color)
      && typeof note.pinned === "boolean" && typeof note.open === "boolean"
      && typeof note.createdAt === "number" && typeof note.updatedAt === "number";
  })) throw new Error("便签数据无法读取，原有数据已保留。");
  return value as StickyNote[];
}

function storeBrowserNotes(notes: StickyNote[]) {
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(notes));
  window.dispatchEvent(new Event(STICKY_NOTES_CHANGED_EVENT));
}

function openBrowserNote(id: string) {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams({ view: "sticky-note", noteId: id }).toString();
  if (!window.open(url, `sticky-note-${id}`, "popup,width=360,height=440")) {
    throw new Error("便签已保存，请允许弹出窗口后从便签列表重新打开。");
  }
}

export async function listStickyNotes(): Promise<StickyNote[]> {
  return isTauri() ? invoke<StickyNote[]>("list_sticky_notes") : loadBrowserNotes();
}

export async function getStickyNote(id: string): Promise<StickyNote | null> {
  return isTauri() ? invoke<StickyNote | null>("get_sticky_note", { id })
    : loadBrowserNotes().find((note) => note.id === id) ?? null;
}

export async function listStickyNoteSummaries(): Promise<StickyNoteSummary[]> {
  if (isTauri()) return invoke<StickyNoteSummary[]>("list_sticky_note_summaries");
  return loadBrowserNotes().map(({ html, text, ...note }) => ({ ...note, text: text ?? notePreview(html) }));
}

export async function createStickyNote(color: NoteColor = "yellow"): Promise<void> {
  if (isTauri()) {
    await invoke("create_sticky_note", { color });
    return;
  }
  const now = Date.now();
  const note: StickyNote = {
    id: crypto.randomUUID(), html: "", color, pinned: false, open: true,
    createdAt: now, updatedAt: now,
  };
  storeBrowserNotes([...loadBrowserNotes(), note]);
  openBrowserNote(note.id);
}

export async function openStickyNote(id: string): Promise<void> {
  if (isTauri()) return invoke("open_sticky_note", { id });
  storeBrowserNotes(loadBrowserNotes().map((note) => note.id === id ? { ...note, open: true } : note));
  openBrowserNote(id);
}

export async function updateStickyNote(id: string, patch: NotePatch): Promise<void> {
  if (isTauri()) return invoke("update_sticky_note", { id, patch });
  const notes = loadBrowserNotes();
  if (!notes.some((note) => note.id === id)) throw new Error("这张便签已被删除。");
  storeBrowserNotes(notes.map((note) => note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note));
}

export async function closeStickyNote(id: string): Promise<void> {
  if (isTauri()) return invoke("close_sticky_note", { id });
  storeBrowserNotes(loadBrowserNotes().map((note) => note.id === id ? { ...note, open: false } : note));
  window.close();
}

export async function deleteStickyNote(id: string): Promise<void> {
  if (isTauri()) return invoke("delete_sticky_note", { id });
  storeBrowserNotes(loadBrowserNotes().filter((note) => note.id !== id));
  if (new URLSearchParams(window.location.search).get("noteId") === id) window.close();
}

export async function subscribeStickyNotes(onChange: () => void): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(STICKY_NOTES_CHANGED_EVENT, onChange);
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === BROWSER_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STICKY_NOTES_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STICKY_NOTES_CHANGED_EVENT, onChange);
  };
}

export function noteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "操作失败，请重试。";
}
