import { AuthService } from '../services/authService.js';
import { loginSchema, userSchema } from '../utils/validation.js';

const authService = new AuthService();

export class AuthController {
  async checkInitialSetup(request, reply) {
    const status = await authService.checkInitialSetup();
    return reply.send({
      success: true,
      data: status,
    });
  }

  async createFirstUser(request, reply) {
    const validatedData = userSchema.parse(request.body);
    const result = await authService.createFirstUser(validatedData, request.server);
    return reply.code(201).send({
      success: true,
      data: result,
      message: 'First user created successfully',
    });
  }

  async register(request, reply) {
    const validatedData = userSchema.parse(request.body);
    const result = await authService.register(validatedData, request.server);
    return reply.code(201).send({
      success: true,
      data: result,
      message: 'User registered successfully',
    });
  }

  async login(request, reply) {
    const validatedData = loginSchema.parse(request.body);
    const result = await authService.login(validatedData, request.server);
    return reply.send({
      success: true,
      data: result,
      message: 'Login successful',
    });
  }

  async getProfile(request, reply) {
    const profile = await authService.getProfile(request.user.id);
    return reply.send({
      success: true,
      data: profile,
    });
  }

  async logout(request, reply) {
    return reply.send({
      success: true,
      message: 'Logout successful',
    });
  }

  async changePassword(request, reply) {
    const { currentPassword, newPassword } = request.body;
    await authService.changePassword(request.user.id, currentPassword, newPassword);
    return reply.send({
      success: true,
      message: 'Password changed successfully',
    });
  }
}
