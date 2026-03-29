import type { FinalResult } from '@preload/contracts';

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

