import dataBackupController from '../controllers/dataBackupController.js';
import { MAX_BACKUP_BYTES } from '../services/dataBackupService.js';

// Encoded backups are sent in the JSON body, so the body limit must comfortably
// exceed the raw archive size (base64 adds ~33%). Restore is the large one.
const RESTORE_BODY_LIMIT = Math.ceil(MAX_BACKUP_BYTES * 1.4);

export default async function dataBackupRoutes(fastify) {
  fastify.get('/groups', {
    schema: {
      tags: ['Backup'],
      summary: 'List selectable backup data groups',
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: dataBackupController.groups,
  });

  fastify.post('/create', {
    schema: {
      tags: ['Backup'],
      summary: 'Create an encoded .nqbackup for the selected data groups',
      body: {
        type: 'object',
        required: ['groups'],
        properties: {
          groups: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:create')],
    handler: dataBackupController.create,
  });

  fastify.post('/preview', {
    bodyLimit: RESTORE_BODY_LIMIT,
    schema: {
      tags: ['Backup'],
      summary: 'Decode and validate a backup, returning its manifest',
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: dataBackupController.preview,
  });

  fastify.post('/restore', {
    bodyLimit: RESTORE_BODY_LIMIT,
    schema: {
      tags: ['Backup'],
      summary: 'Restore selected groups from an encoded backup (transactional)',
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          groups: { type: 'array', items: { type: 'string' } },
          mode: { type: 'string', enum: ['replace'] },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:create')],
    handler: dataBackupController.restore,
  });
}
