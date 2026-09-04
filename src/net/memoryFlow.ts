// Leaving a memory, end to end: checked by the server, then stored.

import { moderateMemory } from "./api";
import { saveMemory, type Memory, type NewMemory } from "./memories";

export { getMemory, isMine, listMemories, rehome, removeMemory, watchMemories } from "./memories";
export type { Memory } from "./memories";

export type SaveResult =
  | { ok: true; memory: Memory; edited: boolean; checked: boolean; local: boolean }
  | { ok: false; reason: string };

export const moderateMemoryAndSave = async (input: NewMemory): Promise<SaveResult> => {
  const verdict = await moderateMemory({
    text: input.text, place: input.place, city: input.city, photo: input.photo,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const memory = await saveMemory({ ...input, text: verdict.text });
  return { ok: true, memory, edited: verdict.edited, checked: verdict.checked, local: memory.id.startsWith("local-") };
};
