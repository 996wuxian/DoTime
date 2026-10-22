import type { TaskTemplate } from "../types";
import type { AppDataDocument } from "./appData";
import {
  commitBackupRestore,
  createAppBackup,
  prepareBackupImages,
  resumeBackupTiming,
  type BackupImport,
} from "./appBackup";
import { FILE_STORAGE_RELOADED_EVENT, mirrorAllDataFiles } from "./fileStorage";
import { readLocalRecord, writeLocalRecord } from "./localDatabase";
import { emitAppDataUpdated } from "../utils/appDataEvents";

let restoreInProgress = false;
const RECOVERY_KEY = "before-last-import";

export function isBackupRestoreInProgress(): boolean {
  return restoreInProgress;
}

export async function readRecoveryBackup(): Promise<string | null> {
  const stored = await readLocalRecord("backups", RECOVERY_KEY);
  return typeof stored === "string" ? stored : null;
}

export async function restoreAppBackup(
  backup: BackupImport,
  current: AppDataDocument,
  templates: readonly TaskTemplate[],
): Promise<void> {
  if (restoreInProgress) throw new Error("另一次恢复正在进行，请稍候。");
  restoreInProgress = true;
  try {
    const previous = await createAppBackup(current, templates);
    await writeLocalRecord("backups", RECOVERY_KEY, JSON.stringify(previous));
    const prepared = await prepareBackupImages(backup.appData);
    const appData = resumeBackupTiming({ ...backup, appData: prepared });
    await commitBackupRestore({ ...backup, appData }, localStorage, mirrorAllDataFiles);
  } finally {
    restoreInProgress = false;
    window.dispatchEvent(new Event(FILE_STORAGE_RELOADED_EVENT));
    void emitAppDataUpdated().catch(() => {});
  }
}
