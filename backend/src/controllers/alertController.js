import alertService from '../services/alertService.js';

export class AlertController {
  /**
   * Get all alerts (overdue installments, low stock, out of stock)
   */
  async getAlerts(request, reply) {
    const alerts = await alertService.getAllAlerts();

    return reply.send({
      success: true,
      data: alerts,
    });
  }
}
