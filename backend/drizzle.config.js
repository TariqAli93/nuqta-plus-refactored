import { defineConfig } from 'drizzle-kit';
import { buildDatabaseUrl } from './src/utils/database.js';

export default defineConfig({
  schema: './src/models/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: buildDatabaseUrl(),
  },
  verbose: true,
  strict: true,
});
