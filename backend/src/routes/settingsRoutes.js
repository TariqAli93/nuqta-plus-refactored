import settingsController from '../controllers/settingsController.js';

export default async function settingsRoutes(fastify) {
  /**
   * Get all settings
   * Returns array of {key, value, description} objects
   */
  fastify.get('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Get all settings',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  key: { type: 'string' },
                  value: { type: 'string' },
                  description: { type: 'string' },
                  updatedAt: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: settingsController.getAll,
  });

  /**
   * Get company information
   * Special endpoint for company-specific settings
   */
  fastify.get('/company', {
    schema: {
      tags: ['Settings'],
      summary: 'Get company information',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                city: { type: 'string' },
                area: { type: 'string' },
                street: { type: 'string' },
                phone: { type: 'string' },
                phone2: { type: 'string' },
                logoUrl: { type: 'string' },
                invoiceType: { type: 'string' },
                invoiceTheme: { type: 'string' },
              },
            },
          },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: settingsController.getCompanyInfo,
  });

  /**
   * Save company information
   */
  fastify.put('/company', {
    schema: {
      tags: ['Settings'],
      summary: 'Save company information',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          city: { type: 'string' },
          area: { type: 'string' },
          street: { type: 'string' },
          phone: { type: 'string' },
          phone2: { type: 'string' },
          logoUrl: { type: 'string' },
          invoiceType: { type: 'string' },
          invoiceTheme: { type: 'string' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: settingsController.saveCompanyInfo,
  });

  /**
   * Get currency settings
   */
  fastify.get('/currency', {
    schema: {
      tags: ['Settings'],
      summary: 'Get currency settings',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                defaultCurrency: { type: 'string' },
                usdRate: { type: 'number' },
                iqdRate: { type: 'number' },
                showSecondaryCurrency: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: settingsController.getCurrencySettings,
  });

  /**
   * Save currency settings
   */
  fastify.put('/currency', {
    schema: {
      tags: ['Settings'],
      summary: 'Save currency settings',
      body: {
        type: 'object',
        properties: {
          defaultCurrency: { type: 'string' },
          usdRate: { type: 'number' },
          iqdRate: { type: 'number' },
          showSecondaryCurrency: { type: 'boolean' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: settingsController.saveCurrencySettings,
  });

  /**
   * Bulk upsert settings
   */
  fastify.put('/bulk', {
    schema: {
      tags: ['Settings'],
      summary: 'Bulk create or update settings',
      body: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'value'],
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: settingsController.bulkUpsert,
  });

  /**
   * Get a single setting by key
   */
  fastify.get('/:key', {
    schema: {
      tags: ['Settings'],
      summary: 'Get a single setting by key',
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: settingsController.getByKey,
  });

  /**
   * Create a new setting
   */
  fastify.post('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Create a new setting',
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:create')],
    handler: settingsController.create,
  });

  /**
   * Update an existing setting
   */
  fastify.put('/:key', {
    schema: {
      tags: ['Settings'],
      summary: 'Update a setting',
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
      body: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: settingsController.update,
  });

  /**
   * Delete a setting
   */
  fastify.delete('/:key', {
    schema: {
      tags: ['Settings'],
      summary: 'Delete a setting',
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:delete')],
    handler: settingsController.delete,
  });
}
