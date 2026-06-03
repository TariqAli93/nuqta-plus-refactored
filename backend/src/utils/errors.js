/**
 * Custom error classes for application-specific errors
 * These errors provide consistent error handling across the application
 */

/**
 * Base application error class
 * All custom errors extend from this class
 */
export class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code (default: 500)
   * @param {boolean} isOperational - Whether the error is operational (expected) or programming error
   */
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 * Used when request data fails validation
 */
export class ValidationError extends AppError {
  constructor(message, code) {
    super(message, 400);
    this.name = 'ValidationError';
    if (code) this.code = code;
  }
}

/**
 * Authentication error (401)
 * Used when authentication fails or credentials are invalid
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error (403)
 * Used when user doesn't have permission to access a resource
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error (404)
 * Used when a requested resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error (409)
 * Used when there's a conflict with existing data (e.g., duplicate entry)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Database error (500)
 * Used when database operations fail
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
    this.name = 'DatabaseError';
  }
}

/**
 * Translate a low-level PostgreSQL constraint error into a clean, user-facing
 * AppError carrying an Arabic message — so the end user never sees raw database
 * text (SQL, constraint names, codes). Returns `null` when the error is not a
 * recognised constraint violation, letting the caller decide what to do
 * (usually: log the original and throw a generic Arabic error).
 *
 * Relevant PostgreSQL SQLSTATE codes:
 *   23503 → foreign_key_violation (row is still referenced elsewhere)
 *   23505 → unique_violation      (duplicate value)
 *   23502 → not_null_violation
 *   23514 → check_violation
 *
 * @param {Error} error - the caught error (may be a wrapped pg error)
 * @param {object} [opts]
 * @param {string} [opts.fkMessage] - Arabic message to use for FK violations
 * @returns {AppError|null}
 */
export function translateDbConstraintError(error, { fkMessage } = {}) {
  // Drizzle/pg may wrap the driver error; check the error and its `.cause`.
  const code = error?.code || error?.cause?.code;
  if (typeof code !== 'string') return null;

  switch (code) {
    case '23503':
      return new ConflictError(
        fkMessage || 'لا يمكن حذف هذا العنصر لأنه مستخدم في بيانات أخرى مسجلة داخل النظام.'
      );
    case '23505':
      return new ConflictError('القيمة المُدخلة موجودة مسبقاً داخل النظام.');
    case '23502':
      return new ValidationError('بيانات ناقصة: أحد الحقول المطلوبة فارغ.');
    case '23514':
      return new ValidationError('القيمة المُدخلة غير مقبولة وفق قواعد النظام.');
    default:
      return null;
  }
}
