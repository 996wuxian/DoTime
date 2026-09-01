import { invoke } from "@tauri-apps/api/core";
import {
  APP_DATA_STORAGE_KEY,
  LEGACY_TODO_STORAGE_KEY,
} from "./appData";
import {
  TASK_TEMPLATE_BACKUP_KEY,
  TASK_TEMPLATE_STORAGE_KEY,
} from "./taskTemplates";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

type DataFileBinding = {
  storageKey: string;
  fileName: string;
};

const DATA_FILE_BINDINGS: DataFileBinding[] = [
  { storageKey: APP_DATA_STORAGE_KEY, fileName: "app-data.json" },
  {
    storageKey: `${APP_DATA_STORAGE_KEY}-backup-1`,
    fileName: "app-data-backup-1.json",
  },
  {
    storageKey: `${APP_DATA_STORAGE_KEY}-backup-2`,
    fileName: "app-data-backup-2.json",
  },
  {
    storageKey: `${APP_DATA_STORAGE_KEY}-backup-3`,
    fileName: "app-data-backup-3.json",
  },
  {
    storageKey: TASK_TEMPLATE_STORAGE_KEY,
    fileName: "task-templates.json",
  },
  {
    storageKey: TASK_TEMPLATE_BACKUP_KEY,
    fileName: "task-templates-backup.json",
  },
];

const APP_DATA_STORAGE_KEYS = DATA_FILE_BINDINGS.filter((binding) =>
  binding.storageKey.startsWith(APP_DATA_STORAGE_KEY),
).map((binding) => binding.storageKey);
const TASK_TEMPLATE_STORAGE_KEYS = [
  TASK_TEMPLATE_STORAGE_KEY,
  TASK_TEMPLATE_BACKUP_KEY,
];
export const FILE_STORAGE_RELOADED_EVENT = "dotime-file-storage-reloaded";

let initialized = false;

function canUseTauriCommands(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

async function readDataFile(fileName: string): Promise<string | null> {
  return invoke<string | null>("read_data_file", { fileName });
}

async function writeDataFile(fileName: string, content: string): Promise<void> {
  await invoke("write_data_file", { fileName, content });
}

async function removeDataFile(fileName: string): Promise<void> {
  await invoke("remove_data_file", { fileName });
}

async function mirrorBindings(bindings: readonly DataFileBinding[]): Promise<void> {
  if (!canUseTauriCommands()) return;

  await Promise.all(
    bindings.map(async ({ storageKey, fileName }) => {
      const value = localStorage.getItem(storageKey);
      if (value == null) {
        await removeDataFile(fileName);
        return;
      }
      await writeDataFile(fileName, value);
    }),
  );
}

async function loadBindingsIntoLocalStorage(
  bindings: readonly DataFileBinding[],
): Promise<void> {
  for (const { storageKey, fileName } of bindings) {
    const fileContent = await readDataFile(fileName);
    if (fileContent != null) {
      localStorage.setItem(storageKey, fileContent);
    }
  }
}

export async function initializeFileBackedDataStore(): Promise<void> {
  if (initialized || !canUseTauriCommands()) return;
  initialized = true;

  try {
    for (const { storageKey, fileName } of DATA_FILE_BINDINGS) {
      const fileContent = await readDataFile(fileName);
      if (fileContent != null) {
        localStorage.setItem(storageKey, fileContent);
        continue;
      }

      const existing = localStorage.getItem(storageKey);
      if (existing != null) {
        await writeDataFile(fileName, existing);
      }
    }

    if (
      localStorage.getItem(APP_DATA_STORAGE_KEY) == null &&
      localStorage.getItem(LEGACY_TODO_STORAGE_KEY) != null
    ) {
      // The normal app-data parser will upgrade this legacy browser storage
      // on first save, then the save effect mirrors it into the JSON file.
      return;
    }
  } catch (error) {
    console.error("failed to initialize file-backed data store", error);
  }
}

export function mirrorAppDataStorage(): void {
  void mirrorBindings(
    DATA_FILE_BINDINGS.filter((binding) =>
      APP_DATA_STORAGE_KEYS.includes(binding.storageKey),
    ),
  ).catch((error) => {
    console.error("failed to mirror app data files", error);
  });
}

export function mirrorTaskTemplateStorage(): void {
  void mirrorBindings(
    DATA_FILE_BINDINGS.filter((binding) =>
      TASK_TEMPLATE_STORAGE_KEYS.includes(binding.storageKey),
    ),
  ).catch((error) => {
    console.error("failed to mirror task template files", error);
  });
}

export async function mirrorAllDataFiles(): Promise<void> {
  await mirrorBindings(DATA_FILE_BINDINGS);
}

export async function getDataDirectory(): Promise<string | null> {
  if (!canUseTauriCommands()) return null;
  try {
    return await invoke<string>("get_data_directory");
  } catch {
    return null;
  }
}

export async function openDataDirectory(): Promise<void> {
  await invoke("open_data_directory");
}

export async function migrateDataDirectory(path: string): Promise<string> {
  await mirrorAllDataFiles();
  const migratedDirectory = await invoke<string>("migrate_data_directory", {
    newDirectory: path,
  });
  await loadBindingsIntoLocalStorage(DATA_FILE_BINDINGS);
  window.dispatchEvent(new Event(FILE_STORAGE_RELOADED_EVENT));
  return migratedDirectory;
}
