/** 接口检查使用会话隔离，用户输入错误不会使服务退出。 */
import { beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { encodeIco } from 'icojs';
import { createApp, prepareStorage } from '../src/server/app.js';
const app = createApp();
let cookie = '';
beforeAll(async () => {
  await prepareStorage();
  const response = await request(app).get('/api/health');
  cookie = response.headers['set-cookie'][0].split(';')[0];
});
describe('上传与配置校验', () => {
  test('健康检查', async () => {
    expect((await request(app).get('/api/health')).body.ok).toBe(true);
  });
  test('活动会话保持原 ID 并延续有效期', async () => {
    const response = await request(app).get('/api/health').set('Cookie', cookie);
    expect(response.headers['set-cookie'][0].split(';')[0]).toBe(cookie);
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=3600');
  });
  test('空 HTML 和非目标文件被拒绝', async () => {
    for (const body of [Buffer.alloc(0), Buffer.from('<html>无模型</html>')]) {
      const response = await request(app)
        .post('/api/uploads')
        .set('Cookie', cookie)
        .field('filename', '测试.html')
        .attach('file', body, '测试.html');
      expect(response.status).toBe(400);
      expect(response.body.error).toBeTruthy();
    }
  });
  test('错误配置和跨站写入被拒绝', async () => {
    expect((await request(app).post('/api/conversions').send({})).status).toBe(400);
    expect(
      (await request(app).post('/api/conversions').set('Origin', 'https://other.example').send({}))
        .status,
    ).toBe(403);
  });
  test('图片以无脚本 PNG 保存', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="blue"/><script>alert(1)</script></svg>',
    );
    const response = await request(app)
      .post('/api/logo-assets')
      .set('Cookie', cookie)
      .attach('file', svg, '图标.svg');
    expect(response.status).toBe(201);
    expect(response.body.preview).toMatch(/^data:image\/png;base64,/);
  });
  test('损坏的媒体输入有可恢复错误', async () => {
    const response = await request(app)
      .post('/api/logo-assets')
      .attach('file', Buffer.from('not image'), '损坏.png');
    expect(response.status).toBe(400);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
  test('ICO 图标实际解码为 PNG', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#2563eb' },
    })
      .png()
      .toBuffer();
    const icon = await encodeIco([{ buffer: png }]);
    const response = await request(app)
      .post('/api/logo-assets')
      .attach('file', Buffer.from(icon), '图标.ico');
    expect(response.status).toBe(201);
    expect(response.body.preview).toMatch(/^data:image\/png;base64,/);
  });
});
