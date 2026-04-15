import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import config from '../config.js';
import { getDb } from '../db.js';
import { users } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { hasPermission } from '../auth/permissionMatrix.js';

async function authPlugin(fastify) {
  // Register JWT
  await fastify.register(jwt, {
    secret: config.jwt.secret,
  });

  // Decorate request with auth methods
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();

      // Get user from database
      const db = await getDb();
      const [user] = await db.select().from(users).where(eq(users.id, request.user.id)).limit(1);

      if (!user || !user.isActive) {
        throw new AuthenticationError('User not found or inactive');
      }

      request.user = user;
    } catch (error) {
      console.error(error);
      if (error.message.includes('No token provided')) {
        throw new AuthenticationError('Token is required');
      } else {
        throw new AuthenticationError('Invalid or expired token');
      }
    }
  });

  // Authorization middleware - checks if user has required permission
  fastify.decorate('authorize', function (requiredPermission) {
    return async function (request, reply) {
      // Ensure user is authenticated first
      await fastify.authenticate(request, reply);

      // Get user role
      const userRole = request.user?.role;

      if (!userRole) {
        throw new AuthorizationError('User role not found');
      }

      // Check if user has required permission
      if (!hasPermission(requiredPermission, userRole)) {
        throw new AuthorizationError(`Permission denied: ${requiredPermission}`);
      }
    };
  });
}

export default fp(authPlugin);
