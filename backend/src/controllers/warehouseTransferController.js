import warehouseTransferService from '../services/warehouseTransferService.js';
import { stockTransferSchema } from '../utils/validation.js';

export class WarehouseTransferController {
  async list(request, reply) {
    const { status, page, limit } = request.query || {};
    const result = await warehouseTransferService.list(request.user, {
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return reply.send({ success: true, data: result.data, meta: result.meta });
  }

  async create(request, reply) {
    const validated = stockTransferSchema.parse(request.body);
    const data = await warehouseTransferService.create(validated, request.user);
    return reply.code(201).send({
      success: true,
      data,
      message: 'Transfer request created',
    });
  }

  async getById(request, reply) {
    const data = await warehouseTransferService.getById(
      Number(request.params.id),
      request.user
    );
    return reply.send({ success: true, data });
  }

  async approve(request, reply) {
    const data = await warehouseTransferService.approve(
      Number(request.params.id),
      request.user
    );
    return reply.send({ success: true, data, message: 'Transfer approved' });
  }

  async reject(request, reply) {
    const data = await warehouseTransferService.reject(
      Number(request.params.id),
      request.body?.reason,
      request.user
    );
    return reply.send({ success: true, data, message: 'Transfer rejected' });
  }
}
