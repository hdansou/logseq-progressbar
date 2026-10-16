/**
 * Registry of live renderer slots.
 *
 * Every `{{renderer :progress-bar}}` the host mounts gets one entry keyed
 * by its slot id. A monotonically increasing generation per slot lets the
 * adapter drop the result of a render that was superseded while its async
 * DB work was in flight, so two overlapping renders of one slot can never
 * publish out of order.
 */
export interface SlotEntry {
  slot: string;
  args: string[];
  uuid: string;
}

export interface SlotRegistry {
  track(slot: string, args: string[], uuid: string): SlotEntry;
  forget(slot: string): void;
  /** Start a render: returns the generation the caller must hold. */
  begin(slot: string): number;
  /** True while `generation` is the latest render started for `slot`. */
  isCurrent(slot: string, generation: number): boolean;
  entries(): SlotEntry[];
  clear(): void;
  readonly size: number;
}

export function createSlotRegistry(): SlotRegistry {
  const entries = new Map<string, SlotEntry>();
  const generations = new Map<string, number>();

  return {
    track(slot, args, uuid) {
      const entry = { slot, args, uuid };
      entries.set(slot, entry);
      return entry;
    },
    forget(slot) {
      entries.delete(slot);
      generations.delete(slot);
    },
    begin(slot) {
      const next = (generations.get(slot) ?? 0) + 1;
      generations.set(slot, next);
      return next;
    },
    isCurrent(slot, generation) {
      return entries.has(slot) && generations.get(slot) === generation;
    },
    entries() {
      return [...entries.values()];
    },
    clear() {
      entries.clear();
      generations.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
