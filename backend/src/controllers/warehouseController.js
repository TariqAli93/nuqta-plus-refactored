import warehouseService from '../services/warehouseService.js';
import { warehouseSchema } from '../utils/validation.js';

export class WarehouseController {
  async getAll(request, reply) {
    const { branchId, activeOnly } = request.query || {};
    const data = await warehouseService.getAll({
      branchId: branchId ? Number(branchId) : undefined,
      activeOnly: activeOnly === 'true' || activeOnly === true,
    });
    return reply.send({ success: true, data });
  }

  async getById(request, reply) {
    const data = await warehouseService.getById(Number(request.params.id));
    return reply.send({ success: true, data });
  }

  async create(request, reply) {
    const validated = warehouseSchema.parse(request.body);
    const data = await warehouseService.create(validated);
    return reply.code(201).send({ success: true, data, message: 'Warehouse created' });
  }

  async update(request, reply) {
    const validated = warehouseSchema.partial().parse(request.body);
    const data = await warehouseService.update(Number(request.params.id), validated);
    return reply.send({ success: true, data, message: 'Warehouse updated' });
  }

  async delete(request, reply) {
    const data = await warehouseService.delete(Number(request.params.id));
    return reply.send({ success: true, data, message: data.message });
  }
}
