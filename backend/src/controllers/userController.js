import { UserService } from '../services/userService.js';
import { z } from 'zod';

const userService = new UserService();

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  role: z.enum(['admin', 'cashier', 'manager', 'viewer']).default('cashier'),
});

const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  role: z.enum(['admin', 'cashier', 'manager', 'viewer']).optional(),
  isActive: z.boolean().optional(),
});

export class UserController {
  async list(request, reply) {
    const { page = 1, limit = 10, search, role, isActive } = request.query || {};
    const result = await userService.list({
      page: Number(page),
      limit: Number(limit),
      search,
      role: role || undefined,
      isActive: typeof isActive !== 'undefined' ? isActive === 'true' : undefined,
    });
    return reply.send({ success: true, data: result });
  }

  async getById(request, reply) {
    const { id } = request.params;
    const user = await userService.getById(Number(id));
    return reply.send({ success: true, data: user });
  }

  async create(request, reply) {
    const data = createUserSchema.parse(request.body);
    const user = await userService.create(data, request.user.id);
    return reply.code(201).send({ success: true, data: user, message: 'User created' });
  }

  async update(request, reply) {
    const { id } = request.params;
    const data = updateUserSchema.parse(request.body);
    const user = await userService.update(Number(id), data, request.user.id);
    return reply.send({ success: true, data: user, message: 'User updated' });
  }

  async resetPassword(request, reply) {
    const { id } = request.params;
    const { password } = request.body || {};
    const result = await userService.resetPassword(Number(id), password, request.user.id);
    return reply.send({ success: true, data: result, message: 'Password reset' });
  }

  async remove(request, reply) {
    const { id } = request.params;
    const result = await userService.remove(Number(id), request.user.id);
    return reply.send({ success: true, data: result, message: 'User deactivated' });
  }

  async checkFirstUser(request, reply) {
    try {
      const exists = await userService.checkFirstUser();
      return reply.send({ success: true, data: { exists } });
    } catch (error) {
      return reply.send({ success: false, message: error.message });
    }
  }
}
