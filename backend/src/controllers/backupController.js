import backupService from '../services/backupService.js';

export class BackupController {
  /**
   * List all backups
   * GET /settings/backups
   */
  async list(request, reply) {
    const backups = await backupService.list();
    return reply.send({ success: true, data: backups });
  }

  /**
   * Create a new backup
   * POST /settings/backups
   */
  async create(request, reply) {
    const backup = await backupService.create();
    return reply.status(201).send({ success: true, data: backup });
  }

  /**
   * Delete a backup
   * DELETE /settings/backups/:filename
   */
  async delete(request, reply) {
    const { filename } = request.params;
    await backupService.delete(filename);
    return reply.send({ success: true, message: 'Backup deleted successfully' });
  }
}

export default new BackupController();
