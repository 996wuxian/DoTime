import { useCallback, useEffect, useRef, useState } from "react";
import { automaticBackupApi, createAutomaticBackupRunner, type AutoBackupSettings, type AutoBackupStatus } from "../data/automaticBackup";
import { isBackupRestoreInProgress } from "../data/backupRestore";

export function useAutomaticBackup(createSnapshot: () => Promise<string>) {
  const supported = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(createSnapshot);
  snapshotRef.current = createSnapshot;
  const alive = useRef(false);
  const runnerRef = useRef<ReturnType<typeof createAutomaticBackupRunner> | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = createAutomaticBackupRunner({
      read: automaticBackupApi.read,
      write: automaticBackupApi.write,
      createSnapshot: () => snapshotRef.current(),
      isRestoring: isBackupRestoreInProgress,
      now: Date.now,
      onStatus: next => { if (alive.current) setStatus(next); },
      onBusy: next => { if (alive.current) setRunning(next); },
      onError: next => { if (alive.current) setError(next); },
    });
  }
  const runner = runnerRef.current;
  useEffect(() => {
    alive.current = true;
    if (!supported) return () => { alive.current = false; };
    const check = () => { void runner.run().finally(() => { if (alive.current) setLoading(false); }); };
    check();
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { alive.current = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [runner, supported]);

  const save = useCallback(async (settings: AutoBackupSettings) => {
    setSaving(true);
    setError(null);
    try {
      const next = await automaticBackupApi.save(settings);
      if (alive.current) setStatus(next);
      runner.resetRetry();
      if (next.enabled) return await runner.run();
      return { created: false };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (alive.current) setError(message);
      return { created: false, error: message };
    } finally {
      if (alive.current) setSaving(false);
    }
  }, [runner]);

  return { supported, status, loading, running, saving, error, save,
    backupNow: () => runner.run(true), openDirectory: automaticBackupApi.openDirectory };
}
