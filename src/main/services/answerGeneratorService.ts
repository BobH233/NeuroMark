import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  AnswerDraftInput,
  AnswerDraftRecord,
  PromptPreset,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { answerDraftsTable } from '@main/database/schema';

const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'structured-marking',
    name: '结构化参考答案',
    description: '适合章节作业或常规试卷，按题号生成评分细则。',
    prompt:
      '请根据题目图片输出 Markdown 版参考答案，并按题号列出评分点、过程分和常见误区。',
  },
  {
    id: 'short-answer-latex',
    name: '公式推导型',
    description: '适合电路、数学、物理等需要内联公式的题目。',
    prompt:
      '请生成适合教师人工复核的 Markdown 参考答案，重点保留公式、推导步骤和每个步骤的分值建议。',
  },
  {
    id: 'objective-commentary',
    name: '客观题+讲评',
    description: '适合选择、填空和判断题，额外输出讲评说明。',
    prompt:
      '请输出标准答案、评分规则和简洁讲评，使用 Markdown 标题分节展示。',
  },
];

export class AnswerGeneratorService {
  async listPromptPresets(): Promise<PromptPreset[]> {
    return PROMPT_PRESETS;
  }

  async listDrafts(): Promise<AnswerDraftRecord[]> {
    const db = getDatabase();
    return db
      .select()
      .from(answerDraftsTable)
      .orderBy(desc(answerDraftsTable.updatedAt))
      .all()
      .map((item) => ({
        id: item.id,
        title: item.title,
        promptPreset: item.promptPreset,
        promptText:
          'promptText' in item && typeof item.promptText === 'string' && item.promptText.trim().length > 0
            ? item.promptText
            : (PROMPT_PRESETS.find((preset) => preset.id === item.promptPreset)?.prompt ?? ''),
        sourceImages: JSON.parse(item.sourceImagesJson) as string[],
        markdown: item.markdown,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  async ensureSeedDraft(): Promise<void> {
    const existing = await this.listDrafts();
    if (existing.length > 0) {
      return;
    }

    await this.createDraft({
      title: `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`,
      promptPreset: PROMPT_PRESETS[0].id,
      promptText: PROMPT_PRESETS[0].prompt,
      sourceImages: [],
    });
  }

  async createDraft(input: AnswerDraftInput): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const preset = PROMPT_PRESETS.find((item) => item.id === input.promptPreset) ?? PROMPT_PRESETS[0];
    const title = input.title.trim() || `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`;
    const promptText = input.promptText.trim() || preset.prompt;
    const record: AnswerDraftRecord = {
      id: nanoid(),
      title,
      promptPreset: preset.id,
      promptText,
      sourceImages: input.sourceImages,
      markdown: `# ${preset.name}\n\n## 参考答案\n### 第1题\n- 关键知识点：请在此补充。\n- 满分建议：10 分\n\n### 第2题\n- 关键知识点：请在此补充。\n- 满分建议：15 分\n\n## 评分规则\n1. 关键步骤完整得满分。\n2. 仅写结论不写过程时酌情扣分。\n3. 表达等价但逻辑正确时可给过程分。\n`,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(answerDraftsTable)
      .values({
        id: record.id,
        title: record.title,
        promptPreset: record.promptPreset,
        promptText: record.promptText,
        sourceImagesJson: JSON.stringify(record.sourceImages),
        markdown: record.markdown,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
      .run();

    return record;
  }

  async updateDraft(draftId: string, markdown: string): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!existing) {
      throw new Error('未找到对应的参考答案草稿。');
    }

    const updatedAt = new Date().toISOString();
    db.update(answerDraftsTable)
      .set({
        markdown,
        updatedAt,
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    return {
      id: existing.id,
      title: existing.title,
      promptPreset: existing.promptPreset,
      promptText:
        'promptText' in existing && typeof existing.promptText === 'string' && existing.promptText.trim().length > 0
          ? existing.promptText
          : (PROMPT_PRESETS.find((preset) => preset.id === existing.promptPreset)?.prompt ?? ''),
      sourceImages: JSON.parse(existing.sourceImagesJson) as string[],
      markdown,
      createdAt: existing.createdAt,
      updatedAt,
    };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const db = getDatabase();
    db.delete(answerDraftsTable).where(eq(answerDraftsTable.id, draftId)).run();
  }
}
