import { pinyin } from 'pinyin-pro';
import type {
  StudentInfo,
  StudentRosterColumnField,
  StudentRosterData,
  StudentRosterEntry,
  StudentRosterField,
} from '@preload/contracts';

export interface ParsedStudentRoster {
  lines: string[];
  rows: string[][];
  columnCount: number;
}

export interface StudentRosterSuggestion extends StudentRosterEntry {
  summary: string;
  score: number;
  matchedBy: string[];
}

const STUDENT_ROSTER_FIELDS: StudentRosterField[] = [
  'studentId',
  'name',
  'className',
];

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

function splitRosterLine(line: string): string[] {
  const trimmed = normalizeText(line);
  if (!trimmed) {
    return [];
  }

  if (trimmed.includes('\t')) {
    return trimmed
      .split(/\t+/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  const commaParts = trimmed
    .split(/[，,]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return commaParts;
  }

  return trimmed
    .split(/\s{2,}/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function isLikelyStudentId(value: string): boolean {
  return /^[A-Za-z0-9_-]{4,}$/.test(value);
}

function isLikelyChineseName(value: string): boolean {
  return /^[\u3400-\u9fff]{2,4}$/.test(value);
}

function isLikelyClassName(value: string): boolean {
  return (
    value.length >= 2 &&
    (/班|级/.test(value) ||
      (/[0-9]/.test(value) && /[\u3400-\u9fffA-Za-z]/.test(value)))
  );
}

function scoreColumn(values: string[], field: StudentRosterField): number {
  if (!values.length) {
    return Number.NEGATIVE_INFINITY;
  }

  const nonEmptyValues = values.filter(Boolean);
  if (!nonEmptyValues.length) {
    return Number.NEGATIVE_INFINITY;
  }

  if (field === 'studentId') {
    return nonEmptyValues.reduce((sum, value) => {
      return (
        sum +
        (isLikelyStudentId(value) ? 4 : 0) +
        (/[0-9]/.test(value) ? 2 : 0) -
        (/[\u3400-\u9fff]/.test(value) ? 3 : 0)
      );
    }, 0);
  }

  if (field === 'name') {
    return nonEmptyValues.reduce((sum, value) => {
      return (
        sum +
        (isLikelyChineseName(value) ? 5 : 0) +
        (/^[A-Za-z]{2,40}$/.test(value) ? 3 : 0) -
        (/[0-9]/.test(value) ? 4 : 0)
      );
    }, 0);
  }

  return nonEmptyValues.reduce((sum, value) => {
    return (
      sum +
      (isLikelyClassName(value) ? 4 : 0) +
      (/[\u3400-\u9fff]/.test(value) ? 1 : 0) +
      (/[0-9]/.test(value) ? 1 : 0)
    );
  }, 0);
}

function buildDefaultColumnFields(
  columnCount: number,
): StudentRosterColumnField[] {
  return Array.from({ length: columnCount }, (_, index) => {
    if (index === 0) {
      return 'studentId';
    }
    if (index === 1) {
      return 'name';
    }
    if (index === 2) {
      return 'className';
    }
    return 'ignore';
  });
}

export function parseStudentRosterText(rawText: string): ParsedStudentRoster {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines
    .map((line) => splitRosterLine(line))
    .filter((row) => row.length > 0);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    lines,
    rows,
    columnCount,
  };
}

export function detectStudentRosterColumnFields(
  parsed: ParsedStudentRoster,
): StudentRosterColumnField[] {
  if (parsed.columnCount === 0) {
    return [];
  }

  const defaultFields = buildDefaultColumnFields(parsed.columnCount);
  const valuesByColumn = Array.from(
    { length: parsed.columnCount },
    (_, index) => parsed.rows.map((row) => row[index] ?? '').filter(Boolean),
  );
  const result = Array<StudentRosterColumnField>(parsed.columnCount).fill(
    'ignore',
  );
  const remainingColumns = new Set(
    valuesByColumn.map((_value, index) => index),
  );

  for (const field of STUDENT_ROSTER_FIELDS) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const columnIndex of remainingColumns) {
      const score = scoreColumn(valuesByColumn[columnIndex], field);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = columnIndex;
      }
    }

    if (bestIndex >= 0 && Number.isFinite(bestScore)) {
      result[bestIndex] = field;
      remainingColumns.delete(bestIndex);
    }
  }

  for (const columnIndex of remainingColumns) {
    result[columnIndex] = defaultFields[columnIndex];
  }

  return result;
}

export function normalizeStudentRosterColumnFields(
  columnCount: number,
  fields: StudentRosterColumnField[],
): StudentRosterColumnField[] {
  if (columnCount <= 0) {
    return [];
  }

  const defaults = buildDefaultColumnFields(columnCount);
  return Array.from({ length: columnCount }, (_unused, index) => {
    const field = fields[index];
    if (
      field === 'studentId' ||
      field === 'name' ||
      field === 'className' ||
      field === 'ignore'
    ) {
      return field;
    }
    return defaults[index];
  });
}

export function buildStudentRosterData(
  rawText: string,
  columnFields: StudentRosterColumnField[],
): StudentRosterData | null {
  const parsed = parseStudentRosterText(rawText);
  if (!parsed.rows.length || parsed.columnCount === 0) {
    return null;
  }

  const normalizedFields = normalizeStudentRosterColumnFields(
    parsed.columnCount,
    columnFields,
  );
  const entries = parsed.rows
    .map((row, rowIndex) => {
      const nextEntry: StudentInfo = {
        className: '',
        studentId: '',
        name: '',
      };

      normalizedFields.forEach((field, columnIndex) => {
        if (field === 'ignore') {
          return;
        }
        nextEntry[field] = normalizeText(row[columnIndex] ?? '');
      });

      if (!nextEntry.className && !nextEntry.studentId && !nextEntry.name) {
        return null;
      }

      return {
        id: `${nextEntry.studentId}::${nextEntry.name}::${nextEntry.className}::${rowIndex}`,
        ...nextEntry,
      } satisfies StudentRosterEntry;
    })
    .filter((entry): entry is StudentRosterEntry => Boolean(entry));

  if (!entries.length) {
    return null;
  }

  return {
    rawText,
    columnFields: normalizedFields,
    entries,
  };
}

function getNameSearchKeys(name: string) {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return {
      text: '',
      fullPinyin: '',
      initials: '',
    };
  }

  const pinyinArray = pinyin(normalizedName, {
    toneType: 'none',
    toneSandhi: false,
    type: 'array',
  });

  return {
    text: normalizedName,
    fullPinyin: normalizeSearchText(pinyinArray.join('')),
    initials: normalizeSearchText(
      pinyinArray.map((item) => item.charAt(0)).join(''),
    ),
  };
}

function computeSuggestionScore(
  entry: StudentRosterEntry,
  field: StudentRosterField,
  query: string,
): { score: number; matchedBy: string[] } {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return { score: 0, matchedBy: [] };
  }

  const matchedBy = new Set<string>();
  let score = 0;
  const fieldValue = normalizeSearchText(entry[field]);
  const studentId = normalizeSearchText(entry.studentId);
  const className = normalizeSearchText(entry.className);
  const {
    text: nameText,
    fullPinyin,
    initials,
  } = getNameSearchKeys(entry.name);
  const normalizedNameText = normalizeSearchText(nameText);

  const applyFieldMatch = (
    target: string,
    label: string,
    weightExact: number,
    weightPrefix: number,
    weightContains: number,
  ) => {
    if (!target) {
      return;
    }
    if (target === normalizedQuery) {
      score += weightExact;
      matchedBy.add(`${label}-exact`);
      return;
    }
    if (target.startsWith(normalizedQuery)) {
      score += weightPrefix;
      matchedBy.add(`${label}-prefix`);
      return;
    }
    if (target.includes(normalizedQuery)) {
      score += weightContains;
      matchedBy.add(`${label}-contains`);
    }
  };

  applyFieldMatch(fieldValue, `field-${field}`, 140, 110, 80);
  applyFieldMatch(studentId, 'student-id', 100, 70, 50);
  applyFieldMatch(className, 'class-name', 90, 65, 45);
  applyFieldMatch(normalizedNameText, 'name-text', 120, 90, 70);
  applyFieldMatch(fullPinyin, 'name-pinyin', 105, 78, 60);
  applyFieldMatch(initials, 'name-initials', 95, 75, 58);

  return {
    score,
    matchedBy: [...matchedBy],
  };
}

export function searchStudentRosterEntries(
  entries: StudentRosterEntry[],
  field: StudentRosterField,
  query: string,
): StudentRosterSuggestion[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  return entries
    .map((entry) => {
      const matchResult = computeSuggestionScore(entry, field, normalizedQuery);
      return {
        ...entry,
        summary: `${entry.name || '未命名'} · 学号 ${entry.studentId || '未填写'} · 班级 ${entry.className || '未填写'}`,
        score: matchResult.score,
        matchedBy: matchResult.matchedBy,
      } satisfies StudentRosterSuggestion;
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.studentId.localeCompare(right.studentId, 'zh-CN', {
          numeric: true,
        }) ||
        left.className.localeCompare(right.className, 'zh-CN')
      );
    });
}
