import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TodoDraft, TodoDraftSnapshot } from "../types";
import { URGENCY_LABELS } from "../types";
import { loadTodoDraft, removeTodoDraft, saveTodoDraft } from "../data/todoDrafts";
import { createDefaultTodoDraft, getDraftExtras, prepareTodoDraft } from "../utils/todoDraft";
import { formatDateKey, formatDisplayDate, formatDurationHuman } from "../utils/time";
import { IconCalendarEvent } from "./icons";

interface QuickTodoFormProps {
  date: string;
  onAdd: (draft: TodoDraft) => void;
}

function emptySnapshot(date: string): TodoDraftSnapshot {
  return { draft: createDefaultTodoDraft(date), countdownTargetTime: "", countdownTimeTouched: false };
}

export function QuickTodoForm({ date, onAdd }: QuickTodoFormProps) {
  const [snapshot, setSnapshot] = useState<TodoDraftSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const submittingRef = useRef(false);
  const revisionRef = useRef(0);
  const draftKey = `new:${date}`;

  useEffect(() => {
    let cancelled = false;
    void loadTodoDraft(draftKey).then((stored) => {
      if (!cancelled) setSnapshot(stored ?? emptySnapshot(date));
    }).catch(() => {
      if (cancelled) return;
      setSnapshot(emptySnapshot(date));
      setNotice({ error: true, message: "暂时无法读取草稿，请及时添加待办。" });
    });
    return () => { cancelled = true; };
  }, [date, draftKey]);

  const updateTitle = (title: string) => {
    if (snapshot == null) return;
    const next = { ...snapshot, draft: { ...snapshot.draft, title } };
    setSnapshot(next);
    setNotice(null);
    const revision = ++revisionRef.current;
    void saveTodoDraft(draftKey, next).catch(() => {
      if (revision === revisionRef.current) {
        setNotice({ error: true, message: "草稿未能保存到本机，请及时添加待办。" });
      }
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (snapshot == null || !snapshot.draft.title.trim() || composingRef.current || submittingRef.current) return;
    submittingRef.current = true;
    revisionRef.current += 1;
    setBusy(true);
    try {
      await removeTodoDraft(draftKey);
      const draft = prepareTodoDraft(snapshot);
      onAdd(draft);
      setSnapshot(emptySnapshot(date));
      setNotice(null);
    } catch {
      void saveTodoDraft(draftKey, snapshot).catch(() => {});
      setNotice({ error: true, message: "添加失败，输入内容已保留，请重试。" });
    } finally {
      submittingRef.current = false;
      setBusy(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const draft = snapshot?.draft;
  const targetDate = draft?.date ?? date;
  const settings = draft == null ? [] : [
    ...(draft.urgency !== "medium" ? [`${URGENCY_LABELS[draft.urgency]}优先级`] : []),
    ...(draft.countdownEnabled
      ? [snapshot?.countdownTimeTouched ? `倒计时至 ${snapshot.countdownTargetTime}` : `倒计时 ${formatDurationHuman(draft.plannedSeconds)}`]
      : draft.recordTimeEnabled ? ["记录时间"] : []),
    ...(draft.countdownOnlyEnabled ? ["立即开始，到点完成"] : []),
    ...getDraftExtras(draft),
  ];

  return (
    <form className="quick-todo card" onSubmit={submit} aria-label="快捷新建待办">
      <div className="quick-todo__row">
        <input
          ref={inputRef}
          aria-label="快捷输入待办内容"
          aria-describedby="quick-todo-hint"
          name="quickTodoTitle"
          value={draft?.title ?? ""}
          onChange={(event) => updateTitle(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
              event.preventDefault();
            }
          }}
          disabled={snapshot == null}
          readOnly={busy}
          maxLength={120}
          autoComplete="off"
          placeholder={snapshot == null ? "读取草稿中…" : "写下要做的事，按 Enter 添加~"}
        />
      </div>
      <div className="quick-todo__hint" id="quick-todo-hint">
        <span><IconCalendarEvent size={13} />添加到{targetDate === formatDateKey() ? "今天" : formatDisplayDate(targetDate)}</span>
        <span>{settings.length > 0 ? `沿用草稿：${settings.join(" · ")}` : "普通待办 · 添加后可连续输入"}</span>
      </div>
      {notice && <p className={`quick-todo__notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.message}</p>}
    </form>
  );
}
