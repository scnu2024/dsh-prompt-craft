/** Draft image admission. Bytes never enter prompts, response envelopes or logs. */
import { abortable, CraftError } from './model.js';

export const IMAGE_LIMITS = Object.freeze({ maxImages: 8, maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024, maxBodyBytes: 28 * 1024 * 1024, maxTextBytes: 256 * 1024 });
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Reject the whole batch before any storage operation. Host validates actual pixels. */
export function readImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CraftError('INVALID_IMAGE', '图片数据格式不正确，请重新添加图片。', 400);
  if (value.length > IMAGE_LIMITS.maxImages) throw new CraftError('TOO_MANY_IMAGES', '每次最多参考 8 张图片，请减少图片后重试。', 413);
  let total = 0;
  const indexes = new Set();
  return value.map(image => {
    if (!image || !Number.isSafeInteger(image.index) || image.index < 1 || indexes.has(image.index) || typeof image.data !== 'string') {
      throw new CraftError('INVALID_IMAGE', '图片编号或数据不正确，请重新添加图片。', 400);
    }
    indexes.add(image.index);
    if (!MEDIA_TYPES.has(image.mediaType)) throw new CraftError('UNSUPPORTED_IMAGE_TYPE', '图片仅支持 PNG、JPEG、WebP 和 GIF。', 400);
    // Bound allocation before decoding; require canonical base64 rather than accepting partial input.
    if (image.data.length > Math.ceil(IMAGE_LIMITS.maxImageBytes / 3) * 4) throw new CraftError('IMAGE_TOO_LARGE', '单张图片不能超过 10 MiB。', 413);
    const data = Buffer.from(image.data, 'base64');
    if (!data.length || data.toString('base64') !== image.data) throw new CraftError('INVALID_IMAGE', '图片数据损坏，请重新添加图片。', 400);
    if (data.length > IMAGE_LIMITS.maxImageBytes) throw new CraftError('IMAGE_TOO_LARGE', '单张图片不能超过 10 MiB。', 413);
    total += data.length;
    if (total > IMAGE_LIMITS.maxTotalBytes) throw new CraftError('IMAGES_TOO_LARGE', '图片总大小不能超过 20 MiB。', 413);
    return { index: image.index, name: typeof image.name === 'string' ? image.name.slice(0, 200) : '', mediaType: image.mediaType, data };
  });
}

export async function admitImages(ctx, images, signal) {
  if (!images.length) return [];
  const store = ctx.get('attachments');
  if (typeof store?.saveImages !== 'function') throw new CraftError('IMAGES_UNAVAILABLE', '宿主未提供图片附件服务，请更新或启用附件服务后重试。', 503);
  try {
    const refs = await abortable(store.saveImages(images.map(({ data, mediaType, name }) => ({ data, mediaType, ...(name ? { name } : {}) }))), signal);
    if (!Array.isArray(refs) || refs.length !== images.length || refs.some(ref => typeof ref?.attachmentId !== 'string')) throw new Error('invalid references');
    return refs.map((attachment, i) => ({ index: images[i].index, name: images[i].name, attachment }));
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    // Providers can include payloads or host paths in errors. Never forward their text.
    throw new CraftError('IMAGE_ADMISSION_FAILED', '图片无法读取或校验未通过，请检查图片格式、大小，或重新添加图片。', 400);
  }
}
