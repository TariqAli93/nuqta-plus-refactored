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

  // Authorization middleware - checks if user has required permission(s).
  // Accepts a single permission string or an array of permissions. When an
  // array is provided, the user passes if they hold *any* of them — useful
  // for endpoints like branch update where branch_admin (inventory:manage)
  // and branch_manager (branches:set_default_warehouse) both need access
  // and the service then enforces the stricter per-role field rules.
  fastify.decorate('authorize', function (requiredPermission) {
    return async function (request, reply) {
      // Ensure user is authenticated first
      await fastify.authenticate(request, reply);

      // Get user role
      const userRole = request.user?.role;

      if (!userRole) {
        throw new AuthorizationError('User role not found');
      }

      const required = Array.isArray(requiredPermission)
        ? requiredPermission
        : [requiredPermission];
      const ok = required.some((perm) => hasPermission(perm, userRole));
      if (!ok) {
        throw new AuthorizationError(`Permission denied: ${required.join(' or ')}`);
      }
    };
  });
}

export default fp(authPlugin);
