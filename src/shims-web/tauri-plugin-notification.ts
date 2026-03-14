export type Options = {
  title?: string;
  body?: string;
  id?: string | number;
  group?: string;
  actionTypeId?: string;
  sound?: string;
  autoCancel?: boolean;
  extra?: Record<string, unknown>;
};

export async function isPermissionGranted(): Promise<boolean> {
  return false;
}

export async function requestPermission(): Promise<"granted" | "denied" | "default"> {
  return "denied";
}

export async function sendNotification(_options: string | Options): Promise<void> {}
