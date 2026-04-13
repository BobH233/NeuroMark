import { ipcMain } from 'electron';
import { z } from 'zod';
import type { ServiceBundle } from '@main/services/types';

const pricingSchema = z.object({
  inputPerMillion: z.number().min(0).max(1000000),
  outputPerMillion: z.number().min(0).max(1000000),
  cacheReadPerMillion: z.number().min(0).max(1000000),
  cacheWritePerMillion: z.number().min(0).max(1000000),
  reasoningPerMillion: z.number().min(0).max(1000000),
});

export function registerLlmUsageIpc(services: ServiceBundle): void {
  ipcMain.handle('llm-usage:get-summary', () => services.llmUsage.getSummary());
  ipcMain.handle('llm-usage:get-record-page', (_event, page?: number, pageSize?: number) =>
    services.llmUsage.getRecordPage(page, pageSize),
  );
  ipcMain.handle('llm-usage:save-pricing', (_event, payload) =>
    services.llmUsage.savePricing({
      currency: 'CNY',
      ...pricingSchema.parse(payload),
    }),
  );
}
