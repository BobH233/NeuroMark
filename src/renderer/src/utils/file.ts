export function toImageSrc(source: string): string {
  if (
    source.startsWith('data:') ||
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('file://')
  ) {
    return source;
  }

  return `file://${source}`;
}

