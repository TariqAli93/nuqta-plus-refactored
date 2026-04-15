import { CustomerService } from '../services/customerService.js';
import { customerSchema } from '../utils/validation.js';

const customerService = new CustomerService();

export class CustomerController {
  async create(request, reply) {
    const validatedData = customerSchema.parse(request.body);
    const customer = await customerService.create(validatedData, request.user.id);
    return reply.code(201).send({
      success: true,
      data: customer,
      message: 'Customer created successfully',
    });
  }

  async getAll(request, reply) {
    const result = await customerService.getAll(request.query);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const customer = await customerService.getById(request.params.id);
    return reply.send({
      success: true,
      data: customer,
    });
  }

  async update(request, reply) {
    const validatedData = customerSchema.partial().parse(request.body);
    const customer = await customerService.update(request.params.id, validatedData);
    return reply.send({
      success: true,
      data: customer,
      message: 'Customer updated successfully',
    });
  }

  async delete(request, reply) {
    const result = await customerService.delete(request.params.id);
    return reply.send({
      success: true,
      message: result.message,
    });
  }
}
