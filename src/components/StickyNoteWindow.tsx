import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useStickyNote } from "../hooks/useStickyNote";
import { closeStickyNote, createStickyNote, deleteStickyNote, listStickyNoteSummaries, NOTE_COLORS, noteErrorMessage, openStickyNote, subscribeStickyNotes, type StickyNote, type StickyNoteSummary } from "../data/stickyNotes";
import { notePreview } from "../utils/stickyNoteEditor";
import { StickyNoteEditor } from "./StickyNoteEditor";
import { IconCheck, IconClose, IconDots, IconList, IconNote, IconPin, IconPinOff, IconPlus, IconSearch, IconTrash } from "./icons";
import "./StickyNoteWindow.css";

function StickyNotesList({ currentId, onSelect, onDelete, onError }: {
  currentId: string;
  onSelect: () => void;
  onDelete: (note: StickyNoteSummary, trigger: HTMLButtonElement) => void;
  onError: (message: string) => void;
}) {
  const [notes, setNotes] = useState<StickyNoteSummary[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    let queued = false;
    const refresh = () => {
      if (loading) { queued = true; return; }
      loading = true;
      void listStickyNoteSummaries().then((items) => { if (!disposed) setNotes(items); })
        .catch((error) => { if (!disposed) onError(noteErrorMessage(error)); })
        .finally(() => {
          loading = false;
          if (queued && !disposed) { queued = false; timer = setTimeout(refresh, 200); }
        });
    };
    refresh();
    void subscribeStickyNotes(() => { clearTimeout(timer); timer = setTimeout(refresh, 200); }).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch((error) => onError(noteErrorMessage(error)));
    return () => { disposed = true; clearTimeout(timer); unlisten?.(); };
  }, [onError]);
  const previews = useMemo(() => notes.map((note) => ({ ...note, preview: note.text || "空白便签" })), [notes]);
  const visible = previews
    .filter((note) => note.preview.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return (
    <section className="sticky-note__notes" aria-label="所有便签">
      <div className="sticky-note__notes-heading">
        <h2>所有便签 <span>{notes.length}</span></h2>
        <button type="button" className="sticky-note__button" aria-label="返回编辑" title="返回编辑" onClick={onSelect}><IconClose size={18} /></button>
      </div>
      <label className="sticky-note__search">
        <IconSearch size={16} />
        <input type="search" aria-label="搜索便签" placeholder="搜索便签" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      </label>
      <div className="sticky-note__note-list">
        {visible.map((note) => (
          <article
            key={note.id}
            className="sticky-note__note-card"
            data-note-color={note.color}
          >
            <button
              type="button"
              className="sticky-note__note-open"
              aria-label={`打开便签：${note.preview.slice(0, 80)}`}
              onClick={() => {
                if (note.id === currentId) { onSelect(); return; }
                void openStickyNote(note.id).then(onSelect).catch((error) => onError(noteErrorMessage(error)));
              }}
            >
              <span className="sticky-note__note-preview">{note.preview}</span>
              <span className="sticky-note__note-meta">
                {new Date(note.updatedAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}
                <span>{note.id === currentId ? "当前便签" : note.open ? "已打开" : "已收起"}</span>
                {note.pinned && <IconPin size={13} />}
              </span>
            </button>
            <button
              type="button"
              className="sticky-note__note-delete"
              title="删除便签"
              aria-label={`删除便签：${note.preview.slice(0, 80)}`}
              onClick={(event) => onDelete(note, event.currentTarget)}
            ><IconTrash size={15} /></button>
          </article>
        ))}
        {visible.length === 0 && <p className="sticky-note__empty-list">没有找到相关便签</p>}
      </div>
    </section>
  );
}

export function StickyNoteWindow() {
  const id = new URLSearchParams(window.location.search).get("noteId") ?? "";
  const { note, status, error, patchNote, flush, reload } = useStickyNote(id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; preview: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deletingRef = useRef(false);
  const closing = useRef(false);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await flush();
      await closeStickyNote(id);
    } catch (error) { setActionError(noteErrorMessage(error)); }
    finally { closing.current = false; }
  }, [flush, id]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let boundsTimer: ReturnType<typeof setTimeout> | undefined;
    const register = (cleanup: () => void) => { if (disposed) cleanup(); else cleanups.push(cleanup); };
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      register(await appWindow.onCloseRequested((event) => { event.preventDefault(); void close(); }));
      const saveBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => { void invoke("save_sticky_note_bounds", { id }).catch(console.error); }, 700);
      };
      register(await appWindow.onMoved(saveBounds));
      register(await appWindow.onResized(saveBounds));
    }).catch((error) => setActionError(noteErrorMessage(error)));
    return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); clearTimeout(boundsTimer); };
  }, [close, id]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menuButtonRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (deleteTarget) document.getElementById("sticky-note-cancel-delete")?.focus();
  }, [deleteTarget]);

  function requestDelete(target: StickyNote | StickyNoteSummary, trigger: HTMLButtonElement | null) {
    deleteTriggerRef.current = trigger;
    setDeleteError(null);
    const preview = "html" in target ? notePreview(target.html) : target.text || "空白便签";
    setDeleteTarget({ id: target.id, preview: preview.slice(0, 100) });
    setMenuOpen(false);
  }

  function cancelDelete() {
    if (deletingRef.current) return;
    setDeleteTarget(null);
    setDeleteError(null);
    deleteTriggerRef.current?.focus();
  }

  async function confirmDelete() {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (deleteTarget.id === id) await flush();
      await deleteStickyNote(deleteTarget.id);
      setDeleteTarget(null);
      document.querySelector<HTMLInputElement>(".sticky-note__search input")?.focus();
    } catch (error) {
      setDeleteError(noteErrorMessage(error));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  async function create() {
    setBusy(true);
    try { await flush(); await createStickyNote(note?.color); }
    catch (error) { setActionError(noteErrorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <main
      className="sticky-note"
      data-note-color={note?.color ?? "yellow"}
      aria-label="doTime 便签"
      onKeyDown={(event) => {
        if (deleteTarget) {
          if (event.key === "Escape") { event.preventDefault(); cancelDelete(); }
          return;
        }
        if (event.key === "Escape") {
          if (menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
          else if (listOpen) setListOpen(false);
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); void create(); }
      }}
    >
      <header className="sticky-note__titlebar" data-tauri-drag-region>
        <button type="button" className="sticky-note__button" title="新建便签 (Ctrl+N)" aria-label="新建便签" disabled={busy} onClick={() => void create()}><IconPlus size={23} /></button>
        <div className="sticky-note__drag-area" data-tauri-drag-region>
          <span className="sticky-note__save-state" data-tauri-drag-region role="status" aria-live="polite">
            {status === "error" ? "未保存" : status === "saving" || status === "dirty" ? "保存中…" : note?.pinned ? "已置顶" : "便签"}
          </span>
        </div>
        <button
          type="button" className="sticky-note__button" disabled={!note || !isTauri()}
          title={!isTauri() ? "窗口置顶在桌面应用中可用" : note?.pinned ? "取消置顶" : "置顶窗口"}
          aria-label={note?.pinned ? "取消置顶" : "置顶窗口"} aria-pressed={note?.pinned ?? false}
          onClick={() => { if (note) patchNote({ pinned: !note.pinned }, true); }}
        >{note?.pinned ? <IconPinOff size={18} /> : <IconPin size={18} />}</button>
        <button
          ref={menuButtonRef} type="button" className="sticky-note__button" title="便签选项" aria-label="便签选项"
          aria-expanded={menuOpen} aria-controls="sticky-note-options" disabled={!note}
          onClick={() => setMenuOpen((open) => !open)}
        ><IconDots size={22} /></button>
        <button type="button" className="sticky-note__button sticky-note__close" title="关闭便签（内容自动保留）" aria-label="关闭便签" onClick={() => void close()}><IconClose size={21} /></button>
      </header>

      {note ? <StickyNoteEditor
        initialHtml={note.html}
        onChange={(html) => patchNote({ html })}
        onSave={() => void flush().catch(() => {})}
        onError={setActionError}
      /> : <div className="sticky-note__loading"><IconNote size={28} /><span>{error ?? "正在打开便签…"}</span>{error && <button type="button" onClick={() => void reload()}>重新加载</button>}</div>}

      {menuOpen && note && (
        <div ref={menuRef} className="sticky-note__options" id="sticky-note-options" role="region" aria-label="便签选项">
          <p className="sticky-note__menu-label">便签颜色</p>
          <div className="sticky-note__palette" role="group" aria-label="便签颜色">
            {NOTE_COLORS.map((color) => (
              <button
                key={color.id} type="button" className="sticky-note__swatch" data-note-color={color.id}
                aria-label={color.label} title={color.label} aria-pressed={note.color === color.id}
                onClick={() => { patchNote({ color: color.id }, true); setMenuOpen(false); menuButtonRef.current?.focus(); }}
              >{note.color === color.id && <IconCheck size={17} />}</button>
            ))}
          </div>
          <div className="sticky-note__menu-divider" />
          <button type="button" className="sticky-note__menu-item" onClick={() => { void flush().then(() => { setListOpen(true); setMenuOpen(false); }).catch(() => {}); }}><IconList size={17} /><span>所有便签</span></button>
          <button type="button" className="sticky-note__menu-item sticky-note__menu-item--danger" onClick={() => requestDelete(note, menuButtonRef.current)}><IconTrash size={17} /><span>删除便签</span></button>
        </div>
      )}

      {listOpen && <StickyNotesList currentId={id} onSelect={() => setListOpen(false)} onDelete={requestDelete} onError={setActionError} />}

      {(error || actionError) && note && (
        <div className="sticky-note__error" role="alert">
          <span>{actionError ?? error}</span>
          {error && <button type="button" onClick={() => void flush().catch(() => {})}>重试保存</button>}
          {actionError && <button type="button" aria-label="关闭提示" onClick={() => setActionError(null)}><IconClose size={15} /></button>}
        </div>
      )}

      {deleteTarget && (
        <div className="sticky-note__dialog-backdrop" onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1]?.focus(); }
          else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0]?.focus(); }
        }}>
          <section className="sticky-note__dialog" role="alertdialog" aria-modal="true" aria-labelledby="sticky-note-delete-title" aria-describedby="sticky-note-delete-description">
            <h2 id="sticky-note-delete-title">删除这张便签？</h2>
            <p className="sticky-note__delete-preview">{deleteTarget.preview}</p>
            <p id="sticky-note-delete-description">删除后无法恢复，若该便签已打开，对应窗口也会关闭。</p>
            {deleteError && <p className="sticky-note__delete-error" role="alert">{deleteError}</p>}
            <div>
              <button type="button" id="sticky-note-cancel-delete" disabled={deleting} onClick={cancelDelete}>取消</button>
              <button type="button" className="sticky-note__delete-confirm" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "删除中…" : "删除"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
