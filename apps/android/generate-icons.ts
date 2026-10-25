import { writeFileSync } from "node:fs";
import Jimp from "jimp-compact";
import { z } from "zod";

interface IconVariant {
  name: string;
  background: string;
  foreground: string;
  scale: number;
}

async function main(): Promise<void> {
  const variants: IconVariant[] = [
    { name: "icon.png", background: "#163A2C", foreground: "#B9F5C4", scale: 1 },
    {
      name: "android-icon-foreground.png",
      background: "#00000000",
      foreground: "#B9F5C4",
      scale: 0.66,
    },
    {
      name: "android-icon-monochrome.png",
      background: "#00000000",
      foreground: "#FFFFFF",
      scale: 0.66,
    },
  ];

  await Promise.all(
    variants.map(async ({ name, background, foreground, scale }) => {
      const image = new Jimp(1024, 1024, background);
      const color = Jimp.cssColorToHex(foreground);

      const rect = (x: number, y: number, width: number, height: number) => {
        for (
          let pixelX = Math.round(512 + (x - 512) * scale);
          pixelX < 512 + (x + width - 512) * scale;
          pixelX++
        ) {
          for (
            let pixelY = Math.round(512 + (y - 512) * scale);
            pixelY < 512 + (y + height - 512) * scale;
            pixelY++
          ) {
            image.setPixelColor(color, pixelX, pixelY);
          }
        }
      };

      rect(200, 440, 624, 144);
      rect(260, 300, 108, 424);
      rect(656, 300, 108, 424);
      rect(182, 370, 62, 284);
      rect(780, 370, 62, 284);
      await image.writeAsync(`assets/${name}`);
    }),
  );

  writeFileSync(
    "assets/icon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="220" fill="#163A2C"/><path fill="#B9F5C4" d="M200 440h624v144H200z M260 300h108v424H260z M656 300h108v424H656z M182 370h62v284H182z M780 370h62v284H780z"/></svg>',
  );
}

main().catch((failure) => {
  const error = z.instanceof(Error).safeParse(failure);
  process.stderr.write(`${error.success ? error.data.message : "Unknown icon generation error"}\n`);
  process.exitCode = 1;
});
