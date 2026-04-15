import settingsService from '../services/settingsService.js';
import { z } from 'zod';

const settingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  description: z.string().optional(),
});

const bulkSettingsSchema = z.array(settingSchema);

const companySchema = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  street: z.string().optional(),
  phone: z.string().optional(),
  phone2: z.string().optional(),
  logoUrl: z.string().optional(),
  invoiceType: z.string().optional(),
  invoiceTheme: z.string().optional(),
});

const currencySchema = z.object({
  defaultCurrency: z.string().optional(),
  usdRate: z.number().or(z.string()).optional(),
  iqdRate: z.number().or(z.string()).optional(),
  showSecondaryCurrency: z.boolean().optional(),
});

export class SettingsController {
  /**
   * Get all settings
   * GET /settings
   */
  async getAll(request, reply) {
    const settings = await settingsService.getAll();
    return reply.send({ success: true, data: settings });
  }

  /**
   * Get a single setting by key
   * GET /settings/:key
   */
  async getByKey(request, reply) {
    const { key } = request.params;
    const setting = await settingsService.getByKey(key);
    return reply.send({ success: true, data: setting });
  }

  /**
   * Create a new setting
   * POST /settings
   */
  async create(request, reply) {
    const parsed = settingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, errors: parsed.error.errors });
    }
    const setting = await settingsService.create(parsed.data);
    return reply.status(201).send({ success: true, data: setting });
  }

  /**
   * Update an existing setting
   * PUT /settings/:key
   */
  async update(request, reply) {
    const { key } = request.params;
    const parsed = z
      .object({
        value: z.string().optional(),
        description: z.string().optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ success: false, errors: parsed.error.errors });
    }
    const updated = await settingsService.update(key, parsed.data);
    return reply.send({ success: true, data: updated });
  }

  /**
   * Bulk upsert settings
   * PUT /settings/bulk
   */
  async bulkUpsert(request, reply) {
    const parsed = bulkSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, errors: parsed.error.errors });
    }
    const results = await settingsService.bulkUpsert(parsed.data);
    return reply.send({ success: true, data: results });
  }

  /**
   * Delete a setting
   * DELETE /settings/:key
   */
  async delete(request, reply) {
    const { key } = request.params;
    const result = await settingsService.delete(key);
    return reply.send(result);
  }

  /**
   * Get company information
   * GET /settings/company
   */
  async getCompanyInfo(request, reply) {
    const companyInfo = await settingsService.getCompanyInfo();
    return reply.send({ success: true, data: companyInfo });
  }

  /**
   * Save company information
   * PUT /settings/company
   */
  async saveCompanyInfo(request, reply) {
    const parsed = companySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, errors: parsed.error.errors });
    }
    const companyInfo = await settingsService.saveCompanyInfo(parsed.data);
    return reply.send({ success: true, data: companyInfo });
  }

  /**
   * Get currency settings
   * GET /settings/currency
   */
  async getCurrencySettings(request, reply) {
    const currencySettings = await settingsService.getCurrencySettings();
    return reply.send({ success: true, data: currencySettings });
  }

  /**
   * Save currency settings
   * PUT /settings/currency
   */
  async saveCurrencySettings(request, reply) {
    const parsed = currencySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, errors: parsed.error.errors });
    }
    // Convert string rates to numbers if needed
    const data = { ...parsed.data };
    if (data.usdRate) data.usdRate = Number(data.usdRate);
    if (data.iqdRate) data.iqdRate = Number(data.iqdRate);
    if (data.showSecondaryCurrency !== undefined) {
      data.showSecondaryCurrency =
        data.showSecondaryCurrency === true || data.showSecondaryCurrency === 'true';
    }

    const currencySettings = await settingsService.saveCurrencySettings(data);
    return reply.send({ success: true, data: currencySettings });
  }
}

export default new SettingsController();
