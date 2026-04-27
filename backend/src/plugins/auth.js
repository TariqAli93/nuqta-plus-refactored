import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import config from '../config.js';
import { getDb } from '../db.js';
import { users } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { hasPermission } from '../auth/permissionMatrix.js';
import featureFlagsService from '../services/featureFlagsService.js';
import { getUserCapabilities } from '../services/permissionService.js';

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

  /**
   * Reject the request when the named feature flag is OFF, even if the user
   * is otherwise authorized. Use this on routes that are wholly owned by an
   * optional module (POS, draft invoices, inventory transfers, branches).
   *
   * Returns 403 with { code: 'FEATURE_DISABLED', feature } so the SPA can
   * detect the case and refresh its session/bootstrap.
   */
  fastify.decorate('requireFeature', function (flag) {
    return async function (request) {
      const enabled = await featureFlagsService.isFeatureEnabled(flag);
      if (!enabled) {
        const err = new AuthorizationError(`Feature "${flag}" is disabled`);
        err.statusCode = 403;
        err.code = 'FEATURE_DISABLED';
        err.feature = flag;
        throw err;
      }
    };
  });

  /**
   * Reject the request when the named capability is `false` for the current
   * user. Capabilities are computed from feature flags + role + scope, so
   * this single check covers the "feature off" and "role lacks permission"
   * cases at once.
   *
   * Always run AFTER `fastify.authenticate` (or pair with `authorize` in the
   * onRequest array — `authenticate` is invoked there).
   */
  fastify.decorate('requireCapability', function (capabilityName) {
    return async function (request) {
      await fastify.authenticate(request);
      const caps = await getUserCapabilities(request.user);
      if (caps[capabilityName] !== true) {
        const err = new AuthorizationError(
          `Capability "${capabilityName}" is not granted`
        );
        err.statusCode = 403;
        err.code = 'CAPABILITY_DENIED';
        err.capability = capabilityName;
        throw err;
      }
    };
  });
}

export default fp(authPlugin);
