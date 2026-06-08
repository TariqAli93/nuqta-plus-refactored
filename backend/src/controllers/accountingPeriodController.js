import { z } from 'zod';
import accountingPeriodService, { PERIOD_TYPES } from '../services/accountingPeriodService.js';

const openSchema = z.object({
  type: z.enum(PERIOD_TYPES).default('monthly'),
  branchId: z.coerce.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

const closeSchema = z.object({
  notes: z.string().max(1000).optional(),
});

const listSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  type: z.enum(PERIOD_TYPES).optional(),
  branchId: z.coerce.number().int().positive().optional(),
});

export class AccountingPeriodController {
  async list(request, reply) {
    const filters = listSchema.parse(request.query || {});
    const data = await accountingPeriodService.list(request.user, filters);
    return reply.send({ success: true, data });
  }

  /** The open period (live preview) for the acting user's scope, or null. */
  async current(request, reply) {
    const branchId = request.query?.branchId ? Number(request.query.branchId) : request.user?.assignedBranchId || null;
    const period = await accountingPeriodService.getOpenPeriodForOperation(branchId);
    if (!period) return reply.send({ success: true, data: null });
    const data = await accountingPeriodService.getById(period.id, request.user);
    return reply.send({ success: true, data });
  }

  async getById(request, reply) {
    const data = await accountingPeriodService.getById(Number(request.params.id), request.user);
    return reply.send({ success: true, data });
  }

  async open(request, reply) {
    const payload = openSchema.parse(request.body || {});
    const data = await accountingPeriodService.open(payload, request.user);
    return reply.code(201).send({ success: true, data, message: 'تم فتح القيد المحاسبي' });
  }

  async close(request, reply) {
    const payload = closeSchema.parse(request.body || {});
    const data = await accountingPeriodService.close(Number(request.params.id), request.user, payload);
    return reply.send({ success: true, data, message: 'تم إغلاق القيد المحاسبي' });
  }
}

export default new AccountingPeriodController();
