import { defineConfig } from 'drizzle-kit';
import { dbFilePath } from './src/utils/database.js';

export default defineConfig({
  schema: './src/models/index.js',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbFilePath || './nuqtaplus.db',
  },
  verbose: true,
  strict: true,
});
