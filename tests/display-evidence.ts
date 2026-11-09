/** 验收图只裁取真实浏览器截图并并排排版，画面内容不作绘制或替换。 */
import sharp from 'sharp';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const root = resolve('test-results');
const before = await sharp(`${root}/layout-baseline/phone-390-menu.png`)
  .extract({ left: 0, top: 0, width: 390, height: 245 })
  .png()
  .toBuffer();
const after = await sharp(`${root}/layout-final/phone-390-menu.png`)
  .extract({ left: 0, top: 0, width: 390, height: 245 })
  .png()
  .toBuffer();
await sharp({ create: { width: 800, height: 285, channels: 4, background: '#eef2f7' } })
  .composite([
    {
      input: Buffer.from(
        '<svg width="800" height="35"><text x="16" y="24" font-size="16" fill="#334155">修改前</text><text x="416" y="24" font-size="16" fill="#334155">当前版本</text></svg>',
      ),
      left: 0,
      top: 0,
    },
    { input: before, left: 5, top: 35 },
    { input: after, left: 405, top: 35 },
  ])
  .png()
  .toFile(`${root}/layout-final/menu-comparison.png`);
await sharp(`${root}/layout-final/phone-1640-table.png`)
  .extract({ left: 0, top: 610, width: 1640, height: 290 })
  .png()
  .toFile(`${root}/layout-final/table-filled.png`);
await writeFile(
  `${root}/layout-final/evidence.json`,
  JSON.stringify(
    {
      sources: [
        'layout-baseline/phone-390-menu.png',
        'layout-final/phone-390-menu.png',
        'layout-final/phone-1640-table.png',
      ],
      outputs: ['layout-final/menu-comparison.png', 'layout-final/table-filled.png'],
      method: '实际浏览器截图的裁剪与并排排版',
    },
    null,
    2,
  ),
  'utf8',
);
