/**
 * Limits how many transcription requests this worker sends at once. A single
 * GPU transcribes one stream fastest; parallel requests only make every
 * recording slower (and, before this gate, pushed requests past timeouts).
 */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  get busy(): boolean {
    return this.active >= this.limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

let gate: Gate | undefined;
export function transcriptionGate(limit: number): Gate {
  gate ??= new Gate(limit);
  return gate;
}
