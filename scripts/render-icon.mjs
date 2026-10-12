// renders build/icon.svg into build/icon.ico, the icon electron-builder gives wrontend.exe, its window and its taskbar
// button. every size is drawn from the SVG at that size, so a small one is not a large one scaled down, and each is stored
// in the ico as a PNG.
//
//   npx electron scripts/render-icon.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const BUILD = join(import.meta.dirname, '..', 'build');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// draws the SVG onto a canvas per size, in a hidden window, and returns each as PNG bytes
async function render(svg) {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const source = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(source)};
    await image.decode();
    return ${JSON.stringify(SIZES)}.map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  })()`);
  win.destroy();
  return pngs.map((png) => Buffer.from(png, 'base64'));
}

// an ico file: a header, a directory entry per image, then the images
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length + 16 * pngs.length;
  const entries = pngs.map((png, n) => {
    const entry = Buffer.alloc(16);
    // a width and height of 256 are stored as 0
    entry.writeUInt8(SIZES[n] % 256, 0);
    entry.writeUInt8(SIZES[n] % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

app.whenReady().then(async () => {
  try {
    const pngs = await render(readFileSync(join(BUILD, 'icon.svg')));
    writeFileSync(join(BUILD, 'icon.ico'), ico(pngs));
    console.log(`build/icon.ico -- ${SIZES.join(', ')} px`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
