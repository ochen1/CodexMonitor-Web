export class MenuItem {
  static async new(options: Record<string, unknown>) {
    return new MenuItem(options);
  }

  constructor(public options: Record<string, unknown>) {}
}

export class PredefinedMenuItem {
  static async new(options: Record<string, unknown>) {
    return new PredefinedMenuItem(options);
  }

  constructor(public options: Record<string, unknown>) {}
}

export class Menu {
  static async new(options: Record<string, unknown>) {
    return new Menu(options);
  }

  constructor(public options: Record<string, unknown>) {}

  async popup(_position?: unknown, _window?: unknown): Promise<void> {}
}
