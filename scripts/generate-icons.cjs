const Jimp = require("jimp-compact");
const fs = require("node:fs");
async function main() {
  for (const [name, background, foreground, scale] of [
    ["icon.png", "#163A2C", "#B9F5C4", 1],
    ["android-icon-foreground.png", "#00000000", "#B9F5C4", 0.66],
    ["android-icon-monochrome.png", "#00000000", "#FFFFFF", 0.66],
  ]) {
    const image = new Jimp(1024, 1024, background);
    const color = Jimp.cssColorToHex(foreground);
    const rect = (x, y, w, h) => {
      for (
        let px = Math.round(512 + (x - 512) * scale);
        px < 512 + (x + w - 512) * scale;
        px++
      )
        for (
          let py = Math.round(512 + (y - 512) * scale);
          py < 512 + (y + h - 512) * scale;
          py++
        )
          image.setPixelColor(color, px, py);
    };
    rect(200, 440, 624, 144);
    rect(260, 300, 108, 424);
    rect(656, 300, 108, 424);
    rect(182, 370, 62, 284);
    rect(780, 370, 62, 284);
    await image.writeAsync("assets/" + name);
  }
  fs.writeFileSync(
    "assets/icon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="220" fill="#163A2C"/><path fill="#B9F5C4" d="M200 440h624v144H200z M260 300h108v424H260z M656 300h108v424H656z M182 370h62v284H182z M780 370h62v284H780z"/></svg>',
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
