// Leg photos: whatever is pasted or chosen (a Snipaste or Windows snip, a copied image, a phone photo) is
// shrunk in the browser to about 1000 px on the long side and re-encoded as JPEG. Re-encoding also drops
// hidden data such as a phone photo's GPS location. Small pictures keep their size.
import { MAX_PHOTO_CHARS } from './kml.mjs';

export async function shrinkPhoto(file, { maxSide = 1000 } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('That is not a picture.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This browser cannot read that picture format (for example HEIC). Use a JPEG or PNG, or paste a snip.'); }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent areas would otherwise turn black in a JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55]) {
    const src = canvas.toDataURL('image/jpeg', quality);
    if (src.length <= MAX_PHOTO_CHARS) return { src, width, height };
  }
  throw new Error('That picture is too detailed to store; try a smaller snip.');
}

// The first picture in a paste or drop, or null.
export const pictureFrom = transfer => [...(transfer?.files || [])].find(f => /^image\//.test(f.type))
  || [...(transfer?.items || [])].find(i => i.kind === 'file' && /^image\//.test(i.type))?.getAsFile() || null;
