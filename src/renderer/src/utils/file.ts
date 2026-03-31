export function toImageSrc(source: string, cacheKey?: string | number): string {
  const encodedCacheKey =
    cacheKey === undefined || cacheKey === null || cacheKey === ''
      ? ''
      : encodeURIComponent(String(cacheKey));

  if (
    source.startsWith('data:') ||
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('local-file://')
  ) {
    if (!encodedCacheKey) {
      return source;
    }
    return `${source}${source.includes('?') ? '&' : '?'}v=${encodedCacheKey}`;
  }

  if (source.startsWith('file://')) {
    const fileUrl = new URL(source);
    const encodedPath = encodeURIComponent(decodeURIComponent(fileUrl.pathname));
    return encodedCacheKey
      ? `local-file://image?path=${encodedPath}&v=${encodedCacheKey}`
      : `local-file://image?path=${encodedPath}`;
  }

  const encodedPath = encodeURIComponent(source);
  return encodedCacheKey
    ? `local-file://image?path=${encodedPath}&v=${encodedCacheKey}`
    : `local-file://image?path=${encodedPath}`;
}
