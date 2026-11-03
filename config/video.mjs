// Shared upload policy: known video extensions and compatible declared MIME types.
const formats = {
  mp4: ['video/mp4'],
  m4v: ['video/mp4', 'video/x-m4v'],
  webm: ['video/webm'],
  mov: ['video/quicktime'],
  mkv: ['video/x-matroska', 'video/matroska'],
  avi: ['video/x-msvideo', 'video/avi', 'video/msvideo'],
  mpeg: ['video/mpeg'],
  mpg: ['video/mpeg'],
  ogv: ['video/ogg'],
  ts: ['video/mp2t'],
  mts: ['video/mp2t'],
  m2ts: ['video/mp2t'],
  '3gp': ['video/3gpp'],
  '3g2': ['video/3gpp2'],
};
export const VIDEO_ACCEPT = ['video/*', ...Object.keys(formats).map((ext) => `.${ext}`)].join(',');
export function videoContentType(name, contentType = '') {
  const extension = name.split('.').at(-1)?.toLowerCase();
  const types = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!types) return null;
  const mime = contentType.trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') return types[0];
  return types.includes(mime) ? mime : null;
}
