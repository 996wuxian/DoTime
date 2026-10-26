import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getStickyNote, noteErrorMessage, subscribeStickyNotes, updateStickyNote, type NotePatch, type StickyNote } from "../data/stickyNotes";
import { notePreview, sanitizeNoteHtml } from "../utils/stickyNoteEditor";

function prepareStoredPatch(patch: NotePatch): NotePatch {
  if (patch.html == null) return patch;
  const html = sanitizeNoteHtml(patch.html);
  return { ...patch, html, text: notePreview(html) };
}

export function useStickyNote(id: string) {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [status, setStatus] = useState<"loading" | "saved" | "dirty" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<NotePatch>({});
  const currentNote = useRef<StickyNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const found = await getStickyNote(id);
      if (!found) throw new Error("这张便签不存在或已被删除。");
      setNote(found);
      currentNote.current = found;
      setStatus("saved");
      setError(null);
    } catch (error) {
      setStatus("error");
      setError(noteErrorMessage(error));
    }
  }, [id]);

  const flush = useCallback((): Promise<void> => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    const task = queue.current.catch(() => {}).then(async () => {
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      setStatus("saving");
      try {
        // Sanitization is coalesced with saving, never repeated on each keystroke.
        await updateStickyNote(id, prepareStoredPatch(patch));
        setError(null);
        if (Object.keys(pending.current).length === 0) setStatus("saved");
      } catch (error) {
        pending.current = { ...patch, ...pending.current };
        setStatus("error");
        setError(`未能保存：${noteErrorMessage(error)}`);
        throw error;
      }
    });
    queue.current = task;
    return task;
  }, [id]);

  const patchNote = useCallback((patch: NotePatch, immediate = false) => {
    if (!currentNote.current || !Object.entries(patch).some(([key, value]) => currentNote.current?.[key as keyof NotePatch] !== value)) return;
    currentNote.current = { ...currentNote.current, ...patch };
    pending.current = { ...pending.current, ...patch };
    setNote(currentNote.current);
    setStatus("dirty");
    if (timer.current != null) clearTimeout(timer.current);
    if (immediate) void flush().catch(() => {});
    else timer.current = setTimeout(() => { void flush().catch(() => {}); }, 350);
  }, [flush]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeStickyNotes(() => {
      void getStickyNote(id).then((note) => {
        if (!disposed && !note) {
          pending.current = {};
          if (timer.current != null) clearTimeout(timer.current);
          window.close();
        }
      }).catch(() => {});
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; });
    return () => { disposed = true; unlisten?.(); };
  }, [id]);

  useEffect(() => {
    const onPageHide = () => {
      // Browser preview saves synchronously before its tab disappears.
      if (!isTauri() && Object.keys(pending.current).length > 0) {
        void updateStickyNote(id, prepareStoredPatch(pending.current)).catch(() => {});
      }
    };
    const onBlur = () => { void flush().catch(() => {}); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onBlur);
      if (timer.current != null) clearTimeout(timer.current);
      void flush().catch(() => {});
    };
  }, [flush, id]);

  return { note, status, error, patchNote, flush, reload: load };
}
