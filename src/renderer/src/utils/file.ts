export function toImageSrc(source: string): string {
  if (
    source.startsWith('data:') ||
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('local-file://')
  ) {
    return source;
  }

  if (source.startsWith('file://')) {
    const fileUrl = new URL(source);
    return `local-file://image?path=${encodeURIComponent(decodeURIComponent(fileUrl.pathname))}`;
  }

  return `local-file://image?path=${encodeURIComponent(source)}`;
}
