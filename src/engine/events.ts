// A tiny typed event emitter. The game's modules talk through this rather than
// reaching into each other.

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(name: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(name);
    if (!set) { set = new Set(); this.listeners.set(name, set); }
    set.add(fn as Listener<never>);
    return () => { set!.delete(fn as Listener<never>); };
  }

  once<K extends keyof Events>(name: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { (fn as Listener<Events[K]>)(payload); } catch (caught) { console.error(`listener for ${String(name)} threw`, caught); }
    }
  }
}

/** A value that others can subscribe to. */
export class Signal<T> {
  private subs = new Set<Listener<T>>();
  constructor(private current: T) {}
  get value() { return this.current; }
  set(next: T) {
    if (Object.is(next, this.current)) return;
    this.current = next;
    for (const fn of [...this.subs]) fn(next);
  }
  subscribe(fn: Listener<T>, immediate = true): () => void {
    this.subs.add(fn);
    if (immediate) fn(this.current);
    return () => { this.subs.delete(fn); };
  }
}
