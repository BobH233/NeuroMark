import { describe, expect, it } from 'vitest';
import { estimateEta } from '../../src/main/services/taskManager';

describe('estimateEta', () => {
  it('returns null when progress or speed are invalid', () => {
    expect(estimateEta(0, 0.2)).toBeNull();
    expect(estimateEta(0.5, 0)).toBeNull();
  });

  it('returns a time string when progress is measurable', () => {
    const value = estimateEta(0.5, 0.1);
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

