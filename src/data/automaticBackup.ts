import { invoke } from "@tauri-apps/api/core";

export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_BACKUP_RETRY_MS = 30 * 60 * 1000;

export interface AutoBackupStatus {
  enabled: boolean;
  directory: string;
  defaultDirectory: string;
  keepCount: 7 | 30;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastBackupFile: string | null;
  lastError: string | null;
  lastWarning: string | null;
}

export interface AutoBackupOutcome { status: AutoBackupStatus; created: boolean }
export interface AutoBackupSettings { enabled: boolean; directory: string; keepCount: 7 | 30 }
export interface BackupRunResult { created: boolean; error?: string }

export function formatAutomaticBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /auto_backup/.test(message) && /not found|unknown command|does not exist/i.test(message)
    ? "自动备份组件尚未加载，请完整重启桌面应用。" : message;
}

async function nativeCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error) { throw new Error(formatAutomaticBackupError(error)); }
}

export const automaticBackupApi = {
  read: () => nativeCall<AutoBackupStatus>("get_auto_backup_status"),
  save: (settings: AutoBackupSettings) => nativeCall<AutoBackupStatus>("save_auto_backup_settings", { ...settings }),
  write: (content: string, force: boolean) => nativeCall<AutoBackupOutcome>("write_auto_backup", { content, force }),
  openDirectory: () => nativeCall<void>("open_auto_backup_directory"),
};

export function isAutomaticBackupDue(status: AutoBackupStatus, now: number): boolean {
  if (!status.enabled) return false;
  if (status.lastError && status.lastAttemptAt != null && now - status.lastAttemptAt < AUTO_BACKUP_RETRY_MS) return false;
  return status.lastSuccessAt == null || now - status.lastSuccessAt >= AUTO_BACKUP_INTERVAL_MS;
}

interface RunnerDependencies {
  read: () => Promise<AutoBackupStatus>;
  write: (content: string, force: boolean) => Promise<AutoBackupOutcome>;
  createSnapshot: () => Promise<string>;
  isRestoring: () => boolean;
  now: () => number;
  onStatus: (status: AutoBackupStatus) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: string | null) => void;
}

/** One in-flight export across startup, timer, focus and manual requests. */
export function createAutomaticBackupRunner(deps: RunnerDependencies) {
  let pending: Promise<BackupRunResult> | null = null;
  let retryAt = 0;
  const execute = async (force: boolean): Promise<BackupRunResult> => {
    let writing = false;
    let busy = false;
    try {
      if (deps.isRestoring()) return { created: false };
      const status = await deps.read();
      deps.onStatus(status);
      if (!force && (!isAutomaticBackupDue(status, deps.now()) || deps.now() < retryAt)) return { created: false };
      if (deps.isRestoring()) return { created: false };
      busy = true;
      deps.onBusy(true);
      deps.onError(null);
      const content = await deps.createSnapshot();
      // A restore may begin while image contents are being collected.
      if (deps.isRestoring()) return { created: false };
      writing = true;
      const result = await deps.write(content, force);
      deps.onStatus(result.status);
      retryAt = 0;
      return { created: result.created };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retryAt = deps.now() + AUTO_BACKUP_RETRY_MS;
      deps.onError(message);
      if (writing) {
        try { deps.onStatus(await deps.read()); } catch { /* Keep the original failure visible. */ }
      }
      return { created: false, error: message };
    } finally {
      if (busy) deps.onBusy(false);
    }
  };
  const run = (force = false): Promise<BackupRunResult> => {
    if (pending) return force ? pending.then(result => result.created || result.error ? result : run(true)) : pending;
    const task = execute(force);
    pending = task;
    void task.finally(() => { if (pending === task) pending = null; });
    return task;
  };
  return {
    run,
    resetRetry() { retryAt = 0; },
  };
}
