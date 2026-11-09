/** 离屏绘制优先使用浏览器原生能力，缺少该能力时使用未挂载的标准画布。 */
export function createRenderCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return Object.assign(canvas, {
    convertToBlob(options: ImageEncodeOptions = {}) {
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('画布图像编码失败。'))),
          options.type,
          options.quality,
        );
      });
    },
  });
}
