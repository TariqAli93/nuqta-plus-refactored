import warehouseService from '../services/warehouseService.js';
import { warehouseSchema } from '../utils/validation.js';
import { ensureDefaultWarehouse } from '../services/systemDefaultsService.js';

export class WarehouseController {
  /**
   * Idempotently create (or return) the internal default warehouse. Lets the
   * inventory UI self-heal an install that has no warehouse yet — branch
   * management off and the operator never created one — without forcing them
   * to understand branches first.
   */
  async ensureDefault(request, reply) {
    const id = await ensureDefaultWarehouse();
    const data = await warehouseService.getById(id, request.user);
    return reply.send({ success: true, data, message: 'Default warehouse ready' });
  }

  async getAll(request, reply) {
    const { branchId, activeOnly } = request.query || {};
    const data = await warehouseService.getAll(
      {
        branchId: branchId ? Number(branchId) : undefined,
        activeOnly: activeOnly === 'true' || activeOnly === true,
      },
      request.user
    );
    return reply.send({ success: true, data });
  }

  async getById(request, reply) {
    const data = await warehouseService.getById(Number(request.params.id), request.user);
    return reply.send({ success: true, data });
  }

  async create(request, reply) {
    const validated = warehouseSchema.parse(request.body);
    const data = await warehouseService.create(validated, request.user);
    return reply.code(201).send({ success: true, data, message: 'Warehouse created' });
  }

  async update(request, reply) {
    const validated = warehouseSchema.partial().parse(request.body);
    const data = await warehouseService.update(
      Number(request.params.id),
      validated,
      request.user
    );
    return reply.send({ success: true, data, message: 'Warehouse updated' });
  }

  async delete(request, reply) {
    const data = await warehouseService.delete(Number(request.params.id), request.user);
    return reply.send({ success: true, data, message: data.message });
  }

  /**
   * Return warehouses the caller can use as transfer destinations for the
   * given source warehouse. Branch-bound users still see destinations across
   * all warehouses in their branch — sales/POS scoping does not narrow this.
   */
  async getTransferTargets(request, reply) {
    const sourceWarehouseId = Number(
      request.query?.sourceWarehouseId ?? request.query?.source ?? 0
    );
    const data = await warehouseService.getTransferTargets(sourceWarehouseId, request.user);
    return reply.send({ success: true, data });
  }
}
