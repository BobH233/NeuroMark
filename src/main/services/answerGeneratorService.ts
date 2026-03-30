import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  AnswerDraftInput,
  AnswerDraftRecord,
  PromptPreset,
  PromptPresetInput,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { answerDraftsTable, promptPresetsTable } from '@main/database/schema';

function toPromptPresetRecord(item: typeof promptPresetsTable.$inferSelect): PromptPreset {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    prompt: item.prompt,
  };
}

export class AnswerGeneratorService {
  async listPromptPresets(): Promise<PromptPreset[]> {
    const db = getDatabase();
    return db
      .select()
      .from(promptPresetsTable)
      .orderBy(desc(promptPresetsTable.updatedAt))
      .all()
      .map(toPromptPresetRecord);
  }

  async savePromptPreset(input: PromptPresetInput): Promise<PromptPreset> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = input.id?.trim() || nanoid();

    db.insert(promptPresetsTable)
      .values({
        id,
        name: input.name.trim(),
        description: input.description.trim(),
        prompt: input.prompt.trim(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: promptPresetsTable.id,
        set: {
          name: input.name.trim(),
          description: input.description.trim(),
          prompt: input.prompt.trim(),
          updatedAt: now,
        },
      })
      .run();

    const saved = db.select().from(promptPresetsTable).where(eq(promptPresetsTable.id, id)).get();
    if (!saved) {
      throw new Error('模板保存失败。');
    }
    return toPromptPresetRecord(saved);
  }

  async deletePromptPreset(presetId: string): Promise<void> {
    const db = getDatabase();
    db.delete(promptPresetsTable).where(eq(promptPresetsTable.id, presetId)).run();
  }

  async listDrafts(): Promise<AnswerDraftRecord[]> {
    const db = getDatabase();
    const presets = await this.listPromptPresets();
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
          item.promptText.trim().length > 0
            ? item.promptText
            : (presets.find((preset) => preset.id === item.promptPreset)?.prompt ?? ''),
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

    const presets = await this.listPromptPresets();
    const firstPreset = presets[0];

    await this.createDraft({
      title: `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`,
      promptPreset: firstPreset?.id ?? '',
      promptText: firstPreset?.prompt ?? '',
      sourceImages: [],
    });
  }

  async createDraft(input: AnswerDraftInput): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const presets = await this.listPromptPresets();
    const selectedPreset = presets.find((item) => item.id === input.promptPreset);
    const fallbackPrompt = selectedPreset?.prompt ?? '';
    const title = input.title.trim() || `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`;
    const promptText = input.promptText.trim() || fallbackPrompt;
    const presetName = selectedPreset?.name || '参考答案';
    const record: AnswerDraftRecord = {
      id: nanoid(),
      title,
      promptPreset: selectedPreset?.id ?? '',
      promptText,
      sourceImages: input.sourceImages,
      markdown: `# ${presetName}\n\n## 参考答案\n### 第1题\n- 关键知识点：请在此补充。\n- 满分建议：10 分\n\n### 第2题\n- 关键知识点：请在此补充。\n- 满分建议：15 分\n\n## 评分规则\n1. 关键步骤完整得满分。\n2. 仅写结论不写过程时酌情扣分。\n3. 表达等价但逻辑正确时可给过程分。\n`,
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

    const presets = await this.listPromptPresets();
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
        existing.promptText.trim().length > 0
          ? existing.promptText
          : (presets.find((preset) => preset.id === existing.promptPreset)?.prompt ?? ''),
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
