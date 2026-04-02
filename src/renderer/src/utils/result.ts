import type { FinalResult } from '@preload/contracts';

const EXISTING_MATH_BLOCK_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g;
const BARE_LATEX_EQUATION_RE =
  /(^|[（(：:\s])([A-Za-z][A-Za-z0-9\s_{}()]*\s*=\s*[^。；，,\n]*(?:\\[A-Za-z]+|\/\/|\\parallel|_[{A-Za-z0-9]+|\^[{A-Za-z0-9]+)[^。；，,\n]*)(?=$|[。；，,\n）)])/gm;

export function computeDisplayedTotal(result: FinalResult): number {
  if (typeof result.manualTotalScore === 'number') {
    return result.manualTotalScore;
  }

  return Number(
    result.questionScores.reduce((sum, item) => sum + item.score, 0).toFixed(2),
  );
}

export function cloneFinalResult(result: FinalResult): FinalResult {
  return JSON.parse(JSON.stringify(result)) as FinalResult;
}

export function normalizeMarkdownMath(source: string): string {
  if (!source) {
    return '';
  }

  const preservedSegments: string[] = [];
  const masked = source.replace(EXISTING_MATH_BLOCK_RE, (segment) => {
    const index = preservedSegments.push(segment) - 1;
    return `__NM_MATH_${index}__`;
  });

  const normalized = masked.replace(
    BARE_LATEX_EQUATION_RE,
    (_match, prefix: string, expression: string) => `${prefix}$${expression.trim()}$`,
  );

  return normalized.replace(/__NM_MATH_(\d+)__/g, (_match, indexText: string) => {
    const index = Number(indexText);
    return preservedSegments[index] ?? '';
  });
}
