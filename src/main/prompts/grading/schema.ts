import type { CompiledRubric } from '@main/services/gradingTypes';

export function buildGradingJsonSchema(rubric: CompiledRubric, drawRegions: boolean) {
  const schema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: false,
    properties: {
      studentInfo: {
        type: 'object',
        additionalProperties: false,
        properties: {
          className: { type: 'string' },
          studentId: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['className', 'studentId', 'name'],
      },
      questionScores: {
        type: 'array',
        minItems: rubric.questions.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            questionId: { type: 'string', minLength: 1 },
            questionTitle: { type: 'string', minLength: 1 },
            maxScore: { type: 'number', minimum: 0 },
            score: { type: 'number', minimum: 0 },
            reasoning: { type: 'string', minLength: 1 },
            issues: {
              type: 'array',
              items: { type: 'string' },
            },
            scoreBreakdown: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  criterionId: { type: 'string', minLength: 1 },
                  criterion: { type: 'string', minLength: 1 },
                  maxScore: { type: 'number', minimum: 0 },
                  score: { type: 'number', minimum: 0 },
                  verdict: {
                    type: 'string',
                    enum: ['earned', 'partial', 'missed', 'unclear'],
                  },
                  evidence: { type: 'string', minLength: 1 },
                },
                required: ['criterionId', 'criterion', 'maxScore', 'score', 'verdict', 'evidence'],
              },
            },
          },
          required: ['questionId', 'questionTitle', 'maxScore', 'score', 'reasoning', 'issues', 'scoreBreakdown'],
        },
      },
      totalScore: {
        type: 'number',
        minimum: 0,
        maximum: rubric.totalMaxScore,
      },
      overallComment: {
        type: 'string',
        minLength: 1,
      },
      overallAdvice: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: {
            type: 'string',
            minLength: 1,
          },
          strengths: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          priorityKnowledgePoints: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          attentionPoints: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          encouragement: {
            type: 'string',
            minLength: 1,
          },
        },
        required: ['summary', 'strengths', 'priorityKnowledgePoints', 'attentionPoints', 'encouragement'],
      },
    },
    required: ['studentInfo', 'questionScores', 'totalScore', 'overallComment', 'overallAdvice'],
  };

  if (drawRegions) {
    (schema.properties as Record<string, unknown>).questionRegions = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questionId: {
            type: 'string',
            minLength: 1,
          },
          pageIndex: {
            type: 'integer',
            minimum: 0,
          },
          x: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          y: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          width: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          height: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
        },
        required: ['questionId', 'pageIndex', 'x', 'y', 'width', 'height'],
      },
    };
    (schema.required as string[]).push('questionRegions');
  }

  return schema;
}
