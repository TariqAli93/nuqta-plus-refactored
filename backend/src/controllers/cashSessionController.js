import cashSessionService from '../services/cashSessionService.js';
import { openCashSessionSchema, closeCashSessionSchema } from '../utils/validation.js';

export class CashSessionController {
  async open(request, reply) {
    const data = openCashSessionSchema.parse(request.body || {});
    const session = await cashSessionService.open(data, request.user);
    return reply.code(201).send({
      success: true,
      data: session,
      message: 'Cash session opened',
    });
  }

  async close(request, reply) {
    const data = closeCashSessionSchema.parse(request.body || {});
    const session = await cashSessionService.close(
      Number(request.params.id),
      data,
      request.user
    );
    return reply.send({
      success: true,
      data: session,
      message: 'Cash session closed',
    });
  }

  async getCurrent(request, reply) {
    const session = await cashSessionService.getCurrent(request.user);
    return reply.send({ success: true, data: session });
  }

  async getById(request, reply) {
    const session = await cashSessionService.getById(
      Number(request.params.id),
      request.user
    );
    return reply.send({ success: true, data: session });
  }

  async list(request, reply) {
    const result = await cashSessionService.list(request.query, request.user);
    return reply.send({ success: true, data: result.data, meta: result.meta });
  }
}
