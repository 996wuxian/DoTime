import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Todo, TrashEntry } from "../types";
import { getTrashRestoreBlocker, TRASH_RETENTION_DAYS, TRASH_RETENTION_MS } from "../domain/recycleBin";
import { IconClose, IconSearch, IconTrash } from "./icons";
import "./RecycleBin.css";

interface Props {
  entries: TrashEntry[];
  todos: Todo[];
  onRestore: (ids: string[]) => number;
  onPurge: (ids: string[]) => void;
}

const deletedTime = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function RecycleBin({ entries, todos, onRestore, onPurge }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="btn btn-ghost btn-icon-only recycle-bin-trigger" aria-label={`回收站（${entries.length} 条）`} title="回收站" onClick={() => setOpen(true)}>
      <IconTrash size={16} />{entries.length > 0 && <em>{entries.length > 99 ? "99+" : entries.length}</em>}
    </button>
    {open && <RecycleBinDialog entries={entries} todos={todos} onRestore={onRestore} onPurge={onPurge} onClose={() => setOpen(false)} />}
  </>;
}

function RecycleBinDialog({ entries, todos, onRestore, onPurge, onClose }: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ ids: string[]; title: string } | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    searchRef.current?.focus();
    return () => { dialogRef.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);
  const term = query.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => `${entry.subtask?.value.title ?? entry.todo.title} ${entry.todo.title} ${entry.todo.date}`.toLocaleLowerCase().includes(term));
  const restore = (ids: string[]) => {
    const count = onRestore(ids);
    setNotice(count === ids.length ? `已恢复 ${count} 条记录，计时保持暂停。` : `已恢复 ${count} 条；其余记录需先恢复所属待办或上级子待办，同名标识的现有内容不会被覆盖。`);
  };
  return createPortal(<dialog ref={dialogRef} className="recycle-bin-dialog" aria-labelledby="recycle-bin-title" onCancel={event => {
    event.preventDefault();
    if (pending) setPending(null); else onClose();
  }}>
    <header className="recycle-bin-header"><div><h2 id="recycle-bin-title"><IconTrash size={21} />回收站 <span>{entries.length}</span></h2><p>删除的待办保留 {TRASH_RETENTION_DAYS} 天，恢复到原日期。</p></div><button type="button" className="btn btn-ghost btn-icon-only" aria-label="关闭回收站" onClick={onClose}><IconClose size={18} /></button></header>
    <div className="recycle-bin-toolbar"><label><IconSearch size={16} /><input ref={searchRef} type="search" aria-label="搜索回收站" placeholder="搜索任务名称、所属待办或日期" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" className="btn btn-secondary btn-sm" disabled={!entries.length || !!pending} onClick={() => restore(entries.map(entry => entry.id))}>全部恢复</button><button type="button" className="btn btn-ghost btn-sm recycle-bin-danger" disabled={!entries.length || !!pending} onClick={() => setPending({ ids: entries.map(entry => entry.id), title: `永久删除回收站中的 ${entries.length} 条记录？` })}>清空回收站</button></div>
    {notice && <p className="recycle-bin-notice" role="status">{notice}</p>}
    {pending && <section className="recycle-bin-confirm" role="alert" aria-label="永久删除确认"><strong>{pending.title}</strong><p>永久删除后无法撤销，关联的图片也会被清理。</p><div><button ref={cancelRef} type="button" className="btn btn-secondary btn-sm" onClick={() => setPending(null)}>取消</button><button type="button" className="btn btn-danger btn-sm" onClick={() => { onPurge(pending.ids); setNotice("已永久删除所选记录。"); setPending(null); }}>确认永久删除</button></div></section>}
    <div className="recycle-bin-list" aria-label="已删除记录">
      {visible.map(entry => {
        const blocker = getTrashRestoreBlocker(entry, todos);
        const days = Math.max(1, Math.ceil((entry.deletedAt + TRASH_RETENTION_MS - Date.now()) / 86_400_000));
        return <article className="recycle-bin-entry" key={entry.id}><div className="recycle-bin-entry-content"><span className="recycle-bin-kind">{entry.subtask ? "子待办" : "待办"} · {entry.todo.date}</span><h3>{entry.subtask?.value.title ?? entry.todo.title}</h3>{entry.subtask && <p>所属待办：{entry.todo.title}</p>}{!entry.subtask && <p>{entry.todo.completed ? "已完成" : "未完成"}{entry.todo.subtasks?.length ? ` · ${entry.todo.subtasks.length} 个子待办` : ""}{entry.todo.images?.length ? ` · ${entry.todo.images.length} 张图片` : ""}</p>}<p>删除于 {deletedTime(entry.deletedAt)} · 剩余 {days} 天</p>{blocker && <p className="recycle-bin-blocker">{blocker}</p>}</div><div className="recycle-bin-entry-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={!!blocker || !!pending} onClick={() => restore([entry.id])}>恢复</button><button type="button" className="btn btn-ghost btn-sm recycle-bin-danger" disabled={!!pending} onClick={() => setPending({ ids: [entry.id], title: `永久删除「${entry.subtask?.value.title ?? entry.todo.title}」？` })}>永久删除</button></div></article>;
      })}
      {visible.length === 0 && <div className="recycle-bin-empty"><IconTrash size={34} /><strong>{term ? "没有匹配的记录" : "回收站是空的"}</strong><p>{term ? "换个关键词或日期试试。" : "误删的待办会暂存在这里，可以随时恢复。"}</p></div>}
    </div>
    <footer className="recycle-bin-footer">子待办需在所属待办存在时恢复；恢复不会自动开始计时或补发过期提醒。</footer>
  </dialog>, document.body);
}
