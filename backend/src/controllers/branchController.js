import branchService from '../services/branchService.js';
import { branchSchema } from '../utils/validation.js';
import { enforceBranchScope } from '../services/scopeService.js';

export class BranchController {
  async getAll(request, reply) {
    const data = await branchService.getAll(request.user);
    return reply.send({ success: true, data });
  }

  async getById(request, reply) {
    const id = Number(request.params.id);
    enforceBranchScope(request.user, id);
    const data = await branchService.getById(id);
    return reply.send({ success: true, data });
  }

  async create(request, reply) {
    const validated = branchSchema.parse(request.body);
    const data = await branchService.create(validated, request.user);
    return reply.code(201).send({ success: true, data, message: 'Branch created' });
  }

  async update(request, reply) {
    const id = Number(request.params.id);
    enforceBranchScope(request.user, id);
    const validated = branchSchema.partial().parse(request.body);
    const data = await branchService.update(id, validated, request.user);
    return reply.send({ success: true, data, message: 'Branch updated' });
  }

  async delete(request, reply) {
    const id = Number(request.params.id);
    enforceBranchScope(request.user, id);
    const data = await branchService.delete(id, request.user);
    return reply.send({ success: true, data, message: data.message });
  }

  /**
   * Resolve the default (or first active) warehouse for a branch.
   * Used by the frontend to pick the active warehouse after login or branch
   * switching without making the user choose manually.
   */
  async resolveActiveWarehouse(request, reply) {
    const id = Number(request.params.id);
    enforceBranchScope(request.user, id);
    const data = await branchService.resolveActiveWarehouse(id);
    return reply.send({ success: true, data });
  }
}
