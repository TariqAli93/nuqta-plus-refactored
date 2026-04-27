import { getDb, saveDatabase } from '../db.js';
import { users, settings } from '../models/index.js';
import { hashPassword, comparePassword } from '../utils/helpers.js';
import { AuthenticationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { eq } from 'drizzle-orm';
import { getRolePermissions } from '../auth/permissionMatrix.js';
import config from '../config.js';
import auditService from './auditService.js';
import { resolveUserScope } from './scopeService.js';
import featureFlagsService from './featureFlagsService.js';
import { getUserCapabilities } from './permissionService.js';

export class AuthService {
  /**
   * Check if initial setup is required
   * @returns {Promise<Object>} Initial setup status
   */
  async checkInitialSetup() {
    const db = await getDb();
    // Check if any users exist
    const allUsers = await db.select().from(users).limit(1);
    const hasUsers = allUsers.length > 0;

    // Check if company info exists in settings
    const companySettings = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'company_name'))
      .limit(1);
    const hasCompanyInfo = companySettings.length > 0;

    const isFirstRun = !hasUsers && !hasCompanyInfo;

    return {
      isFirstRun,
      hasUsers,
      hasCompanyInfo,
    };
  }

  /**
   * Create first admin user (only when database is empty)
   * @param {Object} userData - User registration data
   * @param {Object} fastify - Fastify instance for JWT signing
   * @returns {Promise<Object>} Created user and JWT token
   */
  async createFirstUser(userData, fastify) {
    const db = await getDb();
    // Verify database is empty
    const allUsers = await db.select().from(users).limit(1);
    if (allUsers.length > 0) {
      throw new ConflictError('Users already exist. First user setup is not available.');
    }

    // Hash password
    const hashedPassword = await hashPassword(userData.password);

    // Create first user with admin role
    const [newUser] = await db
      .insert(users)
      .values({
        username: userData.username,
        password: hashedPassword,
        fullName: userData.fullName,
        phone: userData.phone,
        role: 'admin', // First user is always admin
        isActive: true,
      })
      .returning();

    // Generate token
    const token = fastify.jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      { expiresIn: config.jwt.expiresIn }
    );

    // Remove password from response
    const userWithoutPassword = { ...newUser };
    delete userWithoutPassword.password;

    saveDatabase();

    await auditService.log({
      userId: newUser.id,
      username: newUser.username,
      action: 'system:first-user-setup',
      resource: 'users',
      resourceId: newUser.id,
      details: { role: 'admin' },
    });

    return {
      user: userWithoutPassword,
      token,
    };
  }

  /**
   * Register new user
   * @param {Object} userData - User registration data
   * @param {Object} fastify - Fastify instance for JWT signing
   * @returns {Promise<Object>} Created user and JWT token
   */
  async register(userData, fastify) {
    const db = await getDb();
    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, userData.username))
      .limit(1);

    if (existingUser) {
      throw new ConflictError('Username already exists');
    }

    // Hash password
    const hashedPassword = await hashPassword(userData.password);

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        username: userData.username,
        password: hashedPassword,
        fullName: userData.fullName,
        phone: userData.phone,
        role: userData.role || 'cashier',
        isActive: true,
      })
      .returning();

    // Generate token
    const token = fastify.jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      { expiresIn: config.jwt.expiresIn }
    );

    // Remove password from response
    const userWithoutPassword = { ...newUser };
    delete userWithoutPassword.password;

    saveDatabase();

    return {
      user: userWithoutPassword,
      token,
    };
  }

  /**
   * User login with credentials validation
   * @param {Object} credentials - Login credentials
   * @param {Object} fastify - Fastify instance for JWT signing
   * @returns {Promise<Object>} User data and JWT token
   */
  async login(credentials, fastify, ipAddress) {
    const db = await getDb();
    // Find user by username
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, credentials.username))
      .limit(1);

    if (!user) {
      await auditService.log({
        action: 'user:login-failed',
        resource: 'users',
        details: { username: credentials.username, reason: 'not found' },
        ipAddress,
      });
      throw new AuthenticationError('Invalid username or password');
    }

    // Check if user account is active
    if (!user.isActive) {
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: 'user:login-failed',
        resource: 'users',
        resourceId: user.id,
        details: { reason: 'inactive account' },
        ipAddress,
      });
      throw new AuthenticationError('Account is inactive');
    }

    // Verify password
    const isValidPassword = await comparePassword(credentials.password, user.password);

    if (!isValidPassword) {
      await auditService.log({
        userId: user.id,
        username: user.username,
        action: 'user:login-failed',
        resource: 'users',
        resourceId: user.id,
        details: { reason: 'wrong password' },
        ipAddress,
      });
      throw new AuthenticationError('Invalid username or password');
    }

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    // Generate JWT token
    const token = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: config.jwt.expiresIn }
    );

    // Save database changes
    saveDatabase();

    await auditService.log({
      userId: user.id,
      username: user.username,
      action: 'user:login',
      resource: 'users',
      resourceId: user.id,
      ipAddress,
    });

    // Remove sensitive data from response
    const userWithoutPassword = { ...user };
    delete userWithoutPassword.password;

    // Resolve branch scope + feature flags + capabilities so the frontend
    // can hydrate on login. `capabilities` is the single source of truth
    // for UI visibility — frontend never re-derives permissions from role.
    const [scope, featureFlags, setupMode, capabilities] = await Promise.all([
      resolveUserScope(user),
      featureFlagsService.getFeatureFlags(),
      featureFlagsService.getSetupMode(),
      getUserCapabilities(user),
    ]);

    return {
      user: {
        ...userWithoutPassword,
        role: user.role,
        permissions: this.getRolePermissions(user.role),
      },
      scope,
      featureFlags,
      setupMode,
      capabilities,
      token,
    };
  }

  /**
   * Get permissions for a role (uses centralized permission matrix)
   * @param {string} role - User role
   * @returns {Array<string>} Array of permission strings
   */
  getRolePermissions(role) {
    return getRolePermissions(role);
  }

  /**
   * Get user profile by ID
   * @param {number} userId - User ID
   * @returns {Promise<Object>} User profile data
   */
  async getProfile(userId) {
    const db = await getDb();
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        role: users.role,
        assignedBranchId: users.assignedBranchId,
        assignedWarehouseId: users.assignedWarehouseId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    user.permissions = this.getRolePermissions(user.role);

    const [scope, featureFlags, setupMode, capabilities] = await Promise.all([
      resolveUserScope(user),
      featureFlagsService.getFeatureFlags(),
      featureFlagsService.getSetupMode(),
      getUserCapabilities(user),
    ]);
    user.scope = scope;
    user.featureFlags = featureFlags;
    user.setupMode = setupMode;
    user.capabilities = capabilities;

    return user;
  }

  /**
   * Change user password
   * @param {number} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<void>}
   */
  async changePassword(userId, currentPassword, newPassword) {
    const db = await getDb();
    // Get user
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password);

    if (!isValidPassword) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await db
      .update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, userId));

    saveDatabase();

    await auditService.log({
      userId,
      username: user.username,
      action: 'user:password-changed',
      resource: 'users',
      resourceId: userId,
    });
  }
}
