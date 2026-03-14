import { invokeBackend } from "./backend";

export function isTauri(): boolean {
  return false;
}

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invokeBackend<T>(command, args);
}

export function convertFileSrc(source: string): string {
  return source;
}
