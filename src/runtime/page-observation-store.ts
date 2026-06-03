export class PageObservationStore<T> {
  private readonly observations = new Map<number, T>();

  get(pageId: number): T | undefined {
    return this.observations.get(pageId);
  }

  set(pageId: number, observation: T): void {
    this.observations.set(pageId, observation);
  }

  delete(pageId: number): void {
    this.observations.delete(pageId);
  }

  clear(): void {
    this.observations.clear();
  }
}
