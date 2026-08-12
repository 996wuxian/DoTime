export const APP_DATA_UPDATED_EVENT = "dotime-app-data-updated";

export async function emitAppDataUpdated() {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(APP_DATA_UPDATED_EVENT, { updatedAt: Date.now() });
}
