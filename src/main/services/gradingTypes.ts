import type { ImageDetailLevel, LlmReasoningEffort } from '@preload/contracts';

export interface CompiledRubricCriterion {
  criterionId: string;
  description: string;
  maxScore: number;
}

export interface CompiledRubricQuestion {
  questionId: string;
  questionTitle: string;
  maxScore: number;
  answerSummary: string;
  scoringPoints: CompiledRubricCriterion[];
}

export interface CompiledRubric {
  paperTitle: string;
  totalMaxScore: number;
  questions: CompiledRubricQuestion[];
}

export interface GradingServiceSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
  imageDetail: ImageDetailLevel;
  gradingTemperature: number;
}
