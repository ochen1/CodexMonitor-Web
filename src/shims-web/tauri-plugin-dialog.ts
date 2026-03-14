export type DialogOptions = Record<string, unknown>;

export async function open(_options?: DialogOptions): Promise<string[] | string | null> {
  return null;
}

export async function save(_options?: DialogOptions): Promise<string | null> {
  return null;
}

export async function ask(_message: string, _options?: DialogOptions): Promise<boolean> {
  return false;
}

export async function message(_message: string, _options?: DialogOptions): Promise<void> {}
