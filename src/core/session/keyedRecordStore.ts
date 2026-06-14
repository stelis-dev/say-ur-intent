/**
 * Generic id-keyed persistence seam for the short-lived local session managers
 * (wallet identity, settings). The manager logic is shared across backends; only
 * this store differs between the in-memory and SQLite implementations, so any
 * review-server process sharing the database can serve sessions another process
 * created.
 */
export interface KeyedRecordStore<T> {
  get(id: string): T | undefined;
  set(id: string, value: T): void;
  delete(id: string): void;
  ids(): string[];
  clear(): void;
}

export class InMemoryKeyedRecordStore<T> implements KeyedRecordStore<T> {
  private readonly records = new Map<string, T>();

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  set(id: string, value: T): void {
    this.records.set(id, value);
  }

  delete(id: string): void {
    this.records.delete(id);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  clear(): void {
    this.records.clear();
  }
}
