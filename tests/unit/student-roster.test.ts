import { describe, expect, it } from 'vitest';
import {
  buildStudentRosterData,
  detectStudentRosterColumnFields,
  parseStudentRosterText,
  searchStudentRosterEntries,
} from '../../src/renderer/src/utils/student-roster';

describe('student roster utils', () => {
  it('parses tabular roster text and detects the three student columns', () => {
    const parsed = parseStudentRosterText(
      ['1120240584\t\t郭爽\t06212404', '1120240587\t\t李泽宣\t06212403'].join(
        '\n',
      ),
    );

    expect(parsed.columnCount).toBe(3);
    expect(detectStudentRosterColumnFields(parsed)).toEqual([
      'studentId',
      'name',
      'className',
    ]);
  });

  it('supports chinese, full pinyin and initials search on roster entries', () => {
    const roster = buildStudentRosterData(
      ['1120240584\t\t郭爽\t06212404', '1120240587\t\t李泽宣\t06212403'].join(
        '\n',
      ),
      ['studentId', 'name', 'className'],
    );

    expect(roster).not.toBeNull();
    const entries = roster?.entries ?? [];

    expect(searchStudentRosterEntries(entries, 'name', '郭爽')[0]?.name).toBe(
      '郭爽',
    );
    expect(
      searchStudentRosterEntries(entries, 'name', 'guoshuang')[0]?.name,
    ).toBe('郭爽');
    expect(searchStudentRosterEntries(entries, 'name', 'gs')[0]?.name).toBe(
      '郭爽',
    );
    expect(
      searchStudentRosterEntries(entries, 'studentId', '06212403')[0]?.name,
    ).toBe('李泽宣');
  });
});
