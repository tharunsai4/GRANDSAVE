import type { DeskState } from "./desk-types";
import { isDeskState } from "./desk-state-validation";

export const MAX_BACKUP_FILE_BYTES = 5_000_000;

export function parseBackup(text: string): DeskState {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_FILE_BYTES) {
    throw new Error("This backup is too large. Choose a file smaller than 5 MB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid GrandSave JSON backup.");
  }
  const state = parsed && typeof parsed === "object" && "state" in parsed
    ? (parsed as { state: unknown }).state
    : parsed;
  if (!isDeskState(state)) {
    throw new Error("This file does not contain a valid GrandSave order desk backup.");
  }
  // Exported backups contain whitespace. Check the compact save request
  // separately so an otherwise valid, pretty-printed export can be restored.
  if (new TextEncoder().encode(JSON.stringify({ state, version: 2_147_483_647 })).length > 1_000_000) {
    throw new Error("These records exceed the desk's saved-data limit of 1 MB.");
  }
  return state;
}
