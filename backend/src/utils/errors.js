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
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
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
