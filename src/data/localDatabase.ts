type LocalStore = "drafts" | "images" | "backups";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise != null) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("dotime-local-data", 1);
    request.onupgradeneeded = () => {
      for (const name of ["drafts", "images", "backups"] as const) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("本地存储被其他窗口占用，请关闭其他 doTime 窗口后重试。"));
  });
  void databasePromise.catch(() => { databasePromise = null; });
  return databasePromise;
}

export async function readLocalRecord(store: LocalStore, key: string): Promise<unknown> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readonly");
    const request = transaction.objectStore(store).get(key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("无法读取本地数据。"));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function writeLocalRecord(
  store: LocalStore,
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("无法保存本地数据。"));
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteLocalRecords(
  store: LocalStore,
  shouldDelete: (key: string) => boolean,
): Promise<number> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let count = 0;
    const transaction = database.transaction(store, "readwrite");
    const request = transaction.objectStore(store).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor == null) return;
      if (typeof cursor.key === "string" && shouldDelete(cursor.key)) {
        cursor.delete();
        count += 1;
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(count);
    transaction.onabort = () => reject(transaction.error ?? new Error("无法移除本地数据。"));
    transaction.onerror = () => reject(transaction.error);
  });
}
