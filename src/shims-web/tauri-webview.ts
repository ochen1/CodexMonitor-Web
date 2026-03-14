const currentWebview = {
  async setZoom(_value: number): Promise<void> {}
};

export function getCurrentWebview() {
  return currentWebview;
}
