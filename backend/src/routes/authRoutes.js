import { AuthController } from '../controllers/authController.js';

const authController = new AuthController();

export default async function authRoutes(fastify) {
  // Public routes

  // Check initial setup status
  fastify.get('/initial-setup', {
    handler: authController.checkInitialSetup,
    schema: {
      description: 'Check if initial setup is required',
      tags: ['auth'],
    },
  });

  fastify.post('/register', {
    handler: authController.register,
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Register new user',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['username', 'password', 'fullName'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          fullName: { type: 'string' },
          phone: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'cashier', 'manager', 'viewer'] },
        },
      },
    },
  });

  fastify.post('/login', {
    handler: authController.login,
    schema: {
      description: 'User login',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          totpCode: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
    },
  });

  // Create first user (only when database is empty)
  fastify.post('/first-user', {
    handler: authController.createFirstUser,
    schema: {
      description: 'Create first admin user',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['username', 'password', 'fullName'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          fullName: { type: 'string' },
          phone: { type: 'string' },
        },
      },
    },
  });

  // Protected routes
  fastify.get('/profile', {
    onRequest: [fastify.authenticate],
    handler: authController.getProfile,
    schema: {
      description: 'Get user profile',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/logout', {
    onRequest: [fastify.authenticate],
    handler: authController.logout,
    schema: {
      description: 'User logout',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.put('/change-password', {
    onRequest: [fastify.authenticate],
    handler: authController.changePassword,
    schema: {
      description: 'Change user password',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 },
        },
      },
    },
  });
}
