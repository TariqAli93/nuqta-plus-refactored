import dataBackupService, { BACKUP_GROUPS } from '../services/dataBackupService.js';

/**
 * Selective, group-based backup/restore over JSON-in-an-encoded-ZIP
 * (.nqbackup). Separate from the pg_dump-based full-database BackupController.
 */
export class DataBackupController {
  /**
   * List the selectable data groups (for building the UI).
   * GET /backup/groups
   */
  async groups(request, reply) {
    const data = Object.entries(BACKUP_GROUPS).map(([key, def]) => ({
      key,
      label: def.label,
      tables: def.tables,
    }));
    return reply.send({ success: true, data });
  }

  /**
   * Create an encoded backup of the selected groups.
   * POST /backup/create  { groups: string[] }
   */
  async create(request, reply) {
    const { groups } = request.body || {};
    const result = await dataBackupService.create(groups);
    request.log.info({ groups, filename: result.filename }, 'data backup created');
    return reply.send({ success: true, data: result });
  }

  /**
   * Decode + validate a backup and return its manifest for preview.
   * POST /backup/preview  { content: string }
   */
  async preview(request, reply) {
    const { content } = request.body || {};
    if (!content) {
      return reply.status(400).send({ success: false, message: 'Backup content is required' });
    }
    const manifest = dataBackupService.preview(content);
    return reply.send({ success: true, data: manifest });
  }

  /**
   * Restore selected groups from an encoded backup, transactionally.
   * POST /backup/restore  { content, groups?, mode? }
   */
  async restore(request, reply) {
    const { content, groups, mode } = request.body || {};
    if (!content) {
      return reply.status(400).send({ success: false, message: 'Backup content is required' });
    }
    const result = await dataBackupService.restore({ content, groups, mode });
    request.log.info(
      { restoredGroups: result.restoredGroups, counts: result.counts },
      'data backup restored'
    );
    return reply.send({ success: true, data: result });
  }
}

export default new DataBackupController();
