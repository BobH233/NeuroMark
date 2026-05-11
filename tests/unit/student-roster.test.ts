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
      ['8394726105\t\t韩知远\tC7A4', '5739182046\t\t陆星禾\tC7A3'].join(
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
      ['8394726105\t\t韩知远\tC7A4', '5739182046\t\t陆星禾\tC7A3'].join(
        '\n',
      ),
      ['studentId', 'name', 'className'],
    );

    expect(roster).not.toBeNull();
    const entries = roster?.entries ?? [];

    expect(searchStudentRosterEntries(entries, 'name', '韩知远')[0]?.name).toBe(
      '韩知远',
    );
    expect(
      searchStudentRosterEntries(entries, 'name', 'hanzhiyuan')[0]?.name,
    ).toBe('韩知远');
    expect(searchStudentRosterEntries(entries, 'name', 'hzy')[0]?.name).toBe(
      '韩知远',
    );
    expect(
      searchStudentRosterEntries(entries, 'studentId', '5739182046')[0]?.name,
    ).toBe('陆星禾');
  });
});
