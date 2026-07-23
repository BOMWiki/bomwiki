export const DEFAULT_READ_PRESSURE_LIMIT = 8;
export const MAX_READ_PRESSURE_LIMIT = 64;
export const ENGINE_LISTEN_BACKLOG = 4096;

const PRESSURE_READ_ROUTE =
  /^\/item\/[A-Za-z0-9._-]+\/(?:rev\/\d+|history|talk|model\/upload)$/;

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READ_PRESSURE_LIMIT;
  return Math.min(MAX_READ_PRESSURE_LIMIT, Math.max(1, Math.trunc(value)));
}

export function parseReadPressureLimit(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value || !/^-?\d+$/.test(value)) return DEFAULT_READ_PRESSURE_LIMIT;
  return boundedLimit(Number(value));
}

export function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

export function isPressureRead(method: string, path: string): boolean {
  return isReadMethod(method) && PRESSURE_READ_ROUTE.test(path);
}

export class ReadPressureGate {
  readonly limit: number;
  #active = 0;

  constructor(limit = DEFAULT_READ_PRESSURE_LIMIT) {
    this.limit = boundedLimit(limit);
  }

  get active(): number {
    return this.#active;
  }

  acquire(): (() => void) | null {
    if (this.#active >= this.limit) return null;
    this.#active++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
    };
  }
}

interface ResponseLifecycle {
  once(event: 'finish' | 'close', listener: () => void): unknown;
}

export function holdReadPressureSlot(
  gate: ReadPressureGate,
  response: ResponseLifecycle,
): boolean {
  const release = gate.acquire();
  if (!release) return false;
  response.once('finish', release);
  response.once('close', release);
  return true;
}
