import { z } from 'zod';
import expensesService from '../services/expensesService.js';

const expenseSchema = z.object({
  branchId: z.coerce.number().int().positive().optional().nullable(),
  category: z.string().trim().min(1, 'Category is required').max(60),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  currency: z.enum(['USD', 'IQD']).default('USD'),
  note: z.string().trim().max(1000).nullable().optional(),
  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
});

const updateExpenseSchema = expenseSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(25),
  category: z.string().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  currency: z.string().optional().default('ALL'),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const summaryQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  currency: z.string().optional().default('ALL'),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export class ExpensesController {
  async create(request, reply) {
    const body = expenseSchema.parse(request.body || {});
    const created = await expensesService.create(body, request.user);
    return reply.code(201).send({
      success: true,
      data: created,
      message: 'Expense recorded',
    });
  }

  async getAll(request, reply) {
    const query = listQuerySchema.parse(request.query || {});
    const result = await expensesService.getAll(query, request.user);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const data = await expensesService.getById(request.params.id, request.user);
    return reply.send({ success: true, data });
  }

  async update(request, reply) {
    const body = updateExpenseSchema.parse(request.body || {});
    const data = await expensesService.update(request.params.id, body, request.user);
    return reply.send({ success: true, data, message: 'Expense updated' });
  }

  async delete(request, reply) {
    const result = await expensesService.delete(request.params.id, request.user);
    return reply.send({ success: true, message: result.message });
  }

  async summary(request, reply) {
    const query = summaryQuerySchema.parse(request.query || {});
    const data = await expensesService.getSummary(query, request.user);
    return reply.send({ success: true, data });
  }
}

export default new ExpensesController();
