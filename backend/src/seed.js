import { getDb, saveDatabase } from './db.js';
import { customers, settings } from './models/index.js';
import { sql } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Starting database seeding...\n');

  try {
    const db = await getDb();
    // Helper: Count rows of a table
    const countTable = async (table) => {
      const result = await db
        .select({ count: sql`count(*)` })
        .from(table)
        .get();
      return Number(result?.count || 0);
    };

    // Helper: Insert if table empty (preserve existing data)
    const insertIfEmpty = async (table, data, label) => {
      const count = await countTable(table);
      if (count === 0) {
        await db.insert(table).values(data);
        console.log(`✓ ${label} inserted`);
      } else {
        console.log(`↩️ ${label} already exist`);
      }
    };

    // ========== DEFAULT CUSTOMER ==========
    console.log('→ Creating default customer...');
    await insertIfEmpty(
      customers,
      [
        {
          name: 'عميل نقدي',
        },
      ],
      'Customers'
    );

    // ========== CURRENCY SETTINGS ==========
    console.log('\n→ Creating currency settings...');
    const settingsCount = await countTable(settings);
    if (settingsCount === 0) {
      await db.insert(settings).values([
        {
          key: 'currency.default',
          value: 'IQD',
          description: 'العملة الافتراضية للنظام',
        },
        {
          key: 'currency.usd_rate',
          value: '1450',
          description: 'سعر صرف الدولار الأمريكي مقابل الدينار العراقي',
        },
        {
          key: 'currency.iqd_rate',
          value: '1',
          description: 'سعر صرف الدينار العراقي (العملة المرجعية)',
        },
      ]);
      console.log('✓ Currency settings inserted');
    } else {
      console.log('↩️ Settings already exist');
    }

    // Save DB to disk
    saveDatabase();

    console.log('\n🌱 Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error during seeding:', error.message);
    console.error(error.stack);
  }
}

seed();
