export enum GlassMaterialVariant {
  Regular = "regular",
  Thin = "thin",
  Thick = "thick"
}

export function isGlassSupported(): boolean {
  return false;
}

export async function setLiquidGlassEffect(_options?: {
  enabled?: boolean;
  cornerRadius?: number;
  variant?: GlassMaterialVariant;
}): Promise<void> {}
