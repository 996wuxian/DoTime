import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PINNED_LAYOUT_UPDATED_EVENT } from "../utils/pinnedWindowLayout";

export function usePinnedLayoutRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen(PINNED_LAYOUT_UPDATED_EVENT, () => {
      if (!disposed) setRevision((value) => value + 1);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(console.error);
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return revision;
}
