import { useState } from "react";
import { createStickyNote, noteErrorMessage } from "../data/stickyNotes";
import { IconClose, IconNote } from "./icons";

export function StickyNoteLauncher() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sticky-note-launcher">
      <button
        type="button" className="btn btn-ghost btn-icon-only" title="新建便签" aria-label="新建便签" disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void createStickyNote().catch((error) => setError(noteErrorMessage(error))).finally(() => setBusy(false));
        }}
      ><IconNote size={17} /></button>
      {error && <div className="sticky-note-launcher__error" role="alert"><span>{error}</span><button type="button" aria-label="关闭提示" onClick={() => setError(null)}><IconClose size={15} /></button></div>}
    </div>
  );
}
