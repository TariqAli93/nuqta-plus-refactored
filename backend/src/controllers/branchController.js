import branchService from '../services/branchService.js';
import { branchSchema } from '../utils/validation.js';

export class BranchController {
  async getAll(request, reply) {
    const data = await branchService.getAll();
    return reply.send({ success: true, data });
  }

  async getById(request, reply) {
    const data = await branchService.getById(Number(request.params.id));
    return reply.send({ success: true, data });
  }

  async create(request, reply) {
    const validated = branchSchema.parse(request.body);
    const data = await branchService.create(validated);
    return reply.code(201).send({ success: true, data, message: 'Branch created' });
  }

  async update(request, reply) {
    const validated = branchSchema.partial().parse(request.body);
    const data = await branchService.update(Number(request.params.id), validated);
    return reply.send({ success: true, data, message: 'Branch updated' });
  }

  async delete(request, reply) {
    const data = await branchService.delete(Number(request.params.id));
    return reply.send({ success: true, data, message: data.message });
  }
}
