export const GRADING_RUBRIC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paperTitle: {
      type: 'string',
      minLength: 1,
    },
    totalMaxScore: {
      type: 'number',
      minimum: 0,
    },
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questionId: {
            type: 'string',
            minLength: 1,
          },
          questionTitle: {
            type: 'string',
            minLength: 1,
          },
          maxScore: {
            type: 'number',
            exclusiveMinimum: 0,
          },
          answerSummary: {
            type: 'string',
            minLength: 1,
          },
          scoringPoints: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                criterionId: {
                  type: 'string',
                  minLength: 1,
                },
                description: {
                  type: 'string',
                  minLength: 1,
                },
                maxScore: {
                  type: 'number',
                  exclusiveMinimum: 0,
                },
              },
              required: ['criterionId', 'description', 'maxScore'],
            },
          },
        },
        required: ['questionId', 'questionTitle', 'maxScore', 'answerSummary', 'scoringPoints'],
      },
    },
  },
  required: ['paperTitle', 'totalMaxScore', 'questions'],
} as const;
