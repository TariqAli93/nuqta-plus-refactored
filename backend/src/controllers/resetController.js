import ResetService from '../services/resetService.js';

const resetService = new ResetService();

export class ResetController {
  async resetDatabase(request, reply) {
    try {
      const result = await resetService.resetDatabase();
      return reply.send({
        success: true,
        message: 'Database reset successfully',
        data: result,
      });
    } catch (error) {
      request.log.error('Failed to reset database:', error);
      return reply.code(500).send({
        success: false,
        message: 'Failed to reset the database',
        error: error.message || 'Unknown error',
      });
    }
  }
}
