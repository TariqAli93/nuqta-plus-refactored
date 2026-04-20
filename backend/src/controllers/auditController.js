import auditService from '../services/auditService.js';

export class AuditController {
  /**
   * GET /api/audit
   * List audit logs with pagination and filters.
   */
  async list(request, reply) {
    const { page, limit, userId, action, resource, startDate, endDate, search } = request.query;
    const result = await auditService.list({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      userId: userId ? Number(userId) : undefined,
      action,
      resource,
      startDate,
      endDate,
      search,
    });
    return reply.send({ success: true, ...result });
  }

  /**
   * GET /api/audit/actions
   * Get distinct action types for filter UI.
   */
  async getActions(request, reply) {
    const actions = await auditService.getDistinctActions();
    return reply.send({ success: true, data: actions });
  }

  /**
   * DELETE /api/audit/purge
   * Delete audit logs older than N days.
   */
  async purge(request, reply) {
    const { days } = request.body;
    if (!days || days < 1) {
      return reply.status(400).send({ success: false, message: 'days must be >= 1' });
    }
    const result = await auditService.purgeOlderThan(Number(days));
    return reply.send({ success: true, ...result });
  }
}

export default new AuditController();
