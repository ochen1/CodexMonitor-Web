type Unlisten = () => void;
type WindowListener<T = unknown> = (event: T) => void;

type WindowEffects = {
  effects?: Effect[];
  state?: EffectState;
  radius?: number;
};

export enum EffectState {
  Active = "active",
  Inactive = "inactive"
}

export enum Effect {
  Sidebar = "sidebar",
  WindowBackground = "window-background",
  Acrylic = "acrylic",
  HudWindow = "hud-window"
}

const currentWindow = {
  label: "main",
  async listen<T = unknown>(_event: string, _callback: WindowListener<T>): Promise<Unlisten> {
    return () => {};
  },
  async onResized(_callback: WindowListener): Promise<Unlisten> {
    return () => {};
  },
  async onDragDropEvent(_callback: WindowListener): Promise<Unlisten> {
    return () => {};
  },
  async startDragging(): Promise<void> {},
  async minimize(): Promise<void> {},
  async maximize(): Promise<void> {},
  async unmaximize(): Promise<void> {},
  async toggleMaximize(): Promise<void> {},
  async close(): Promise<void> {},
  async setFocus(): Promise<void> {},
  async setEffects(_options: WindowEffects): Promise<void> {},
  async isMaximized(): Promise<boolean> {
    return false;
  }
};

export function getCurrentWindow() {
  return currentWindow;
}
