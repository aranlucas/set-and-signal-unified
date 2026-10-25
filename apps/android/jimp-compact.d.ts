declare module "jimp-compact" {
  interface CompactImage {
    setPixelColor(color: number, x: number, y: number): CompactImage;
    writeAsync(path: string): Promise<CompactImage>;
  }

  interface CompactJimp {
    new (width: number, height: number, color: string): CompactImage;
    cssColorToHex(color: string): number;
  }

  const Jimp: CompactJimp;

  export default Jimp;
}
