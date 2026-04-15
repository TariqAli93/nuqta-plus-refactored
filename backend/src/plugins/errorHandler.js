import fp from 'fastify-plugin';
import { AppError } from '../utils/errors.js';
import { ZodError } from 'zod';
import config from '../config.js';

async function errorHandlerPlugin(fastify) {
  fastify.setErrorHandler(function (error, request, reply) {
    // Log error
    request.log.error(error);

    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Validation Error',
        message: 'Invalid request data',
        details: error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
    }

    // Application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name,
        message: error.message,
        timestamp: error.timestamp,
      });
    }

    // JWT errors
    if (error.statusCode === 401) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: error.message || 'Authentication required',
      });
    }

    // Default server error
    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      statusCode,
      error: 'Internal Server Error',
      message: config.server.env === 'production' ? 'An unexpected error occurred' : error.message,
    });
  });

  // 404 handler
  fastify.setNotFoundHandler(function (request, reply) {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
    });
  });
}

export default fp(errorHandlerPlugin);
