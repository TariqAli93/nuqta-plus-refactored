import { getDb } from './db.js';
import {
  users,
  customers,
  categories,
  products,
  sales,
  saleItems,
  payments,
  installments,
  currencySettings,
  settings,
} from './models/index.js';
import { hashPassword } from './utils/helpers.js';
import { sql } from 'drizzle-orm';

// ── Helpers ──────────────────────────────────────────────────────────────────
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickMultiple = (arr, count) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};
const formatDate = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

// ── Seed Data ────────────────────────────────────────────────────────────────

const categoryData = [
  { name: 'هواتف ذكية', description: 'أحدث الهواتف من آبل وسامسونج وغيرها' },
  { name: 'حواسيب محمولة', description: 'لابتوبات للأعمال والألعاب' },
  { name: 'إكسسوارات', description: 'شواحن، سماعات، وكفرات' },
  { name: 'أجهزة منزلية', description: 'خلاطات، مكانس، أدوات مطبخ' },
  { name: 'مواد غذائية', description: 'رز، زيت، معلبات' },
  { name: 'ملابس رجالية', description: 'قمصان، بنطال، أحذية' },
  { name: 'أدوات كهربائية', description: 'توصيلات، مصابيح، بطاريات' },
];

const productData = [
  { name: 'iPhone 15 Pro', cat: 'هواتف ذكية', cost: 1000, price: 1200, sku: 'SKU-1001' },
  { name: 'iPhone 14', cat: 'هواتف ذكية', cost: 750, price: 900, sku: 'SKU-1002' },
  { name: 'Samsung S24 Ultra', cat: 'هواتف ذكية', cost: 950, price: 1150, sku: 'SKU-1003' },
  { name: 'Samsung A54', cat: 'هواتف ذكية', cost: 250, price: 350, sku: 'SKU-1004' },
  { name: 'Xiaomi 14', cat: 'هواتف ذكية', cost: 400, price: 520, sku: 'SKU-1005' },
  { name: 'MacBook Air M2', cat: 'حواسيب محمولة', cost: 900, price: 1100, sku: 'SKU-1010' },
  { name: 'Dell XPS 15', cat: 'حواسيب محمولة', cost: 1100, price: 1300, sku: 'SKU-1011' },
  { name: 'Lenovo ThinkPad', cat: 'حواسيب محمولة', cost: 700, price: 850, sku: 'SKU-1012' },
  { name: 'AirPods Pro 2', cat: 'إكسسوارات', cost: 180, price: 250, sku: 'SKU-1020' },
  { name: 'شاحن Samsung 45W', cat: 'إكسسوارات', cost: 20, price: 40, sku: 'SKU-1021' },
  { name: 'كفر iPhone 15', cat: 'إكسسوارات', cost: 5, price: 15, sku: 'SKU-1022' },
  { name: 'سماعات Sony WH-1000', cat: 'إكسسوارات', cost: 200, price: 300, sku: 'SKU-1023' },
  { name: 'خلاط Philips', cat: 'أجهزة منزلية', cost: 50, price: 80, sku: 'SKU-1030' },
  { name: 'مكنسة Panasonic', cat: 'أجهزة منزلية', cost: 85, price: 120, sku: 'SKU-1031' },
  { name: 'مكواة بخار Tefal', cat: 'أجهزة منزلية', cost: 30, price: 55, sku: 'SKU-1032' },
  { name: 'رز بسمتي 10كغ', cat: 'مواد غذائية', cost: 12, price: 18, sku: 'SKU-1040' },
  { name: 'زيت دوار الشمس 1لتر', cat: 'مواد غذائية', cost: 2, price: 3, sku: 'SKU-1041' },
  { name: 'شاي هيل 500غ', cat: 'مواد غذائية', cost: 3, price: 5, sku: 'SKU-1042' },
  { name: 'قميص رجالي قطن', cat: 'ملابس رجالية', cost: 10, price: 22, sku: 'SKU-1050' },
  { name: 'حذاء رياضي Nike', cat: 'ملابس رجالية', cost: 60, price: 95, sku: 'SKU-1051' },
  { name: 'مصباح LED', cat: 'أدوات كهربائية', cost: 2, price: 5, sku: 'SKU-1060' },
  { name: 'توصيلة كهربائية 5م', cat: 'أدوات كهربائية', cost: 4, price: 8, sku: 'SKU-1061' },
  { name: 'بطارية AA 4-pack', cat: 'أدوات كهربائية', cost: 1, price: 3, sku: 'SKU-1062' },
];

const customerData = [
  { name: 'عميل نقدي', phone: null, address: null, city: null, notes: 'الحساب النقدي الافتراضي' },
  { name: 'أحمد علي', phone: '07701234567', address: 'بغداد - الكرادة', city: 'بغداد', notes: null },
  { name: 'سارة حسن', phone: '07812345678', address: 'بغداد - المنصور', city: 'بغداد', notes: null },
  { name: 'محمد رضا', phone: '07901234567', address: 'بغداد - الأعظمية', city: 'بغداد', notes: 'مفضل للأقساط' },
  { name: 'زينب كاظم', phone: '07712345678', address: 'بغداد - زيونة', city: 'بغداد', notes: null },
  { name: 'حيدر الجبوري', phone: '07801234567', address: 'بغداد - الشعب', city: 'بغداد', notes: 'مفضل للأقساط' },
  { name: 'نور الدين', phone: '07912345678', address: 'البصرة - العشار', city: 'البصرة', notes: null },
  { name: 'فاطمة الزهراء', phone: '07751234567', address: 'النجف - المركز', city: 'النجف', notes: null },
  { name: 'حسين كريم', phone: '07851234567', address: 'كربلاء - المركز', city: 'كربلاء', notes: null },
  { name: 'مريم العبيدي', phone: '07951234567', address: 'أربيل - عينكاوة', city: 'أربيل', notes: null },
  { name: 'علي المحمداوي', phone: '07731234567', address: 'بغداد - الكاظمية', city: 'بغداد', notes: 'مفضل للأقساط' },
  { name: 'يوسف عمر', phone: '07831234567', address: 'بغداد - المأمون', city: 'بغداد', notes: null },
];

// ── Main Seed Function ───────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Starting database seeding...\n');

  try {
    const db = await getDb();

    const countTable = async (table) => {
      const [result] = await db
        .select({ count: sql`count(*)` })
        .from(table);
      return Number(result?.count || 0);
    };

    const insertIfEmpty = async (table, data, label) => {
      const count = await countTable(table);
      if (count === 0) {
        return await db.insert(table).values(data).returning();
      }
      console.log(`  ↩️ ${label} already exist, skipping`);
      return null;
    };

    // ========== ADMIN USER ==========
    console.log('→ Admin user...');
    if ((await countTable(users)) === 0) {
      const hashedPassword = await hashPassword('Admin@123');
      await db.insert(users).values({
        username: 'admin',
        password: hashedPassword,
        fullName: 'مدير النظام',
        role: 'admin',
        phone: '07700000000',
      });
      console.log('  ✓ Admin created (username: admin, password: Admin@123)');
    } else {
      console.log('  ↩️ Users already exist, skipping');
    }

    // ========== CURRENCY SETTINGS ==========
    console.log('→ Currency settings...');
    await insertIfEmpty(
      currencySettings,
      [
        { currencyCode: 'IQD', currencyName: 'دينار عراقي', symbol: 'د.ع', exchangeRate: '1', isBaseCurrency: true },
        { currencyCode: 'USD', currencyName: 'دولار أمريكي', symbol: '$', exchangeRate: '1450', isBaseCurrency: false },
      ],
      'Currency settings'
    ) && console.log('  ✓ Currency settings inserted');

    // ========== DEFAULT SETTINGS ==========
    console.log('→ Default settings...');
    await insertIfEmpty(
      settings,
      [{ key: 'currency.default', value: 'IQD', description: 'العملة الافتراضية للنظام' }],
      'Settings'
    ) && console.log('  ✓ Settings inserted');

    // ========== CATEGORIES ==========
    console.log('→ Categories...');
    let insertedCats = await insertIfEmpty(categories, categoryData.map((c) => ({ ...c, createdBy: 1 })), 'Categories');
    if (insertedCats) {
      console.log(`  ✓ ${insertedCats.length} categories inserted`);
    } else {
      insertedCats = await db.select().from(categories);
    }
    const catMap = insertedCats.reduce((acc, c) => ({ ...acc, [c.name]: c.id }), {});

    // ========== PRODUCTS ==========
    console.log('→ Products...');
    let insertedProducts = await insertIfEmpty(
      products,
      productData.map((p, idx) => ({
        name: p.name,
        sku: p.sku,
        barcode: `${100000000000 + idx}`,
        categoryId: catMap[p.cat] || insertedCats[0]?.id,
        description: `وصف المنتج: ${p.name}`,
        costPrice: String(p.cost),
        sellingPrice: String(p.price),
        currency: 'USD',
        stock: randomInt(10, 100),
        minStock: 5,
        unit: 'piece',
        status: 'available',
        createdBy: 1,
      })),
      'Products'
    );
    if (insertedProducts) {
      console.log(`  ✓ ${insertedProducts.length} products inserted`);
    } else {
      insertedProducts = await db.select().from(products);
    }

    // ========== CUSTOMERS ==========
    console.log('→ Customers...');
    let insertedCustomers = await insertIfEmpty(customers, customerData.map((c) => ({ ...c, createdBy: 1 })), 'Customers');
    if (insertedCustomers) {
      console.log(`  ✓ ${insertedCustomers.length} customers inserted`);
    } else {
      insertedCustomers = await db.select().from(customers);
    }

    // ========== SALES (past 4 months) ==========
    console.log('→ Generating sales history...');
    if ((await countTable(sales)) > 0) {
      console.log('  ↩️ Sales already exist, skipping');
      console.log('\n🌱 Database seeding completed successfully!');
      process.exit(0);
    }

    const nonCashCustomers = insertedCustomers.filter((c) => c.name !== 'عميل نقدي');
    const cashCustomer = insertedCustomers.find((c) => c.name === 'عميل نقدي') || insertedCustomers[0];

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 4);
    const today = new Date();

    let saleCount = 0;
    let invoiceCounter = 1000;

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dailySales = randomInt(1, 4);

      for (let i = 0; i < dailySales; i++) {
        invoiceCounter++;
        const dateStr = formatDate(d);
        const isInstallment = Math.random() > 0.75; // ~25% installment
        const customer = isInstallment
          ? pick(nonCashCustomers)
          : Math.random() > 0.4 ? cashCustomer : pick(nonCashCustomers);

        // Pick 1-3 random products
        const saleProducts = pickMultiple(insertedProducts, randomInt(1, 3));
        let subtotal = 0;
        const items = [];

        for (const p of saleProducts) {
          const qty = randomInt(1, 3);
          const lineTotal = Number(p.sellingPrice) * qty;
          subtotal += lineTotal;
          items.push({
            productId: p.id,
            productName: p.name,
            quantity: qty,
            unitPrice: String(p.sellingPrice),
            subtotal: String(lineTotal),
            discount: '0',
          });
        }

        const discount = Math.random() > 0.8 ? randomInt(2, 15) : 0;
        let total = subtotal - discount;

        if (isInstallment) {
          // ── Installment sale ──
          const interestRate = pick([0, 3, 5]);
          const interestAmount = Number(((total * interestRate) / 100).toFixed(2));
          total += interestAmount;
          const downPayment = Math.floor(total * pick([0.2, 0.3, 0.4]));
          const remaining = Number((total - downPayment).toFixed(2));
          const numInstallments = pick([3, 4, 6]);

          const [sale] = await db
            .insert(sales)
            .values({
              invoiceNumber: `INV-${invoiceCounter}`,
              customerId: customer.id,
              subtotal: String(subtotal),
              discount: String(discount),
              total: String(total.toFixed(2)),
              currency: 'USD',
              paymentType: 'installment',
              paidAmount: String(downPayment),
              remainingAmount: String(remaining),
              interestRate: String(interestRate),
              interestAmount: String(interestAmount),
              status: remaining < 1 ? 'completed' : 'active',
              createdAt: dateStr,
              updatedAt: dateStr,
              createdBy: 1,
            })
            .returning({ id: sales.id });

          // Sale items
          await db.insert(saleItems).values(items.map((it) => ({ ...it, saleId: sale.id, createdAt: dateStr })));

          // Down payment
          await db.insert(payments).values({
            saleId: sale.id,
            customerId: customer.id,
            amount: String(downPayment),
            currency: 'USD',
            paymentMethod: 'cash',
            paymentDate: dateStr,
            notes: 'دفعة أولى',
            createdAt: dateStr,
            createdBy: 1,
          });

          // Installment schedule
          const instAmount = Number((remaining / numInstallments).toFixed(2));
          for (let k = 1; k <= numInstallments; k++) {
            const dueDate = new Date(d);
            dueDate.setMonth(dueDate.getMonth() + k);
            const isPaid = dueDate < today;

            await db.insert(installments).values({
              saleId: sale.id,
              customerId: customer.id,
              installmentNumber: k,
              dueAmount: String(instAmount),
              paidAmount: isPaid ? String(instAmount) : '0',
              remainingAmount: isPaid ? '0' : String(instAmount),
              currency: 'USD',
              dueDate: formatDate(dueDate),
              paidDate: isPaid ? formatDate(dueDate) : null,
              status: isPaid ? 'paid' : 'pending',
              createdAt: dateStr,
              createdBy: 1,
            });

            if (isPaid) {
              await db.insert(payments).values({
                saleId: sale.id,
                customerId: customer.id,
                amount: String(instAmount),
                currency: 'USD',
                paymentMethod: 'cash',
                paymentDate: formatDate(dueDate),
                notes: `قسط رقم ${k}`,
                createdAt: formatDate(dueDate),
                createdBy: 1,
              });
            }
          }
        } else {
          // ── Cash sale ──
          const [sale] = await db
            .insert(sales)
            .values({
              invoiceNumber: `INV-${invoiceCounter}`,
              customerId: customer.id,
              subtotal: String(subtotal),
              discount: String(discount),
              total: String(total.toFixed(2)),
              currency: 'USD',
              paymentType: 'cash',
              paidAmount: String(total.toFixed(2)),
              remainingAmount: '0',
              status: 'completed',
              createdAt: dateStr,
              updatedAt: dateStr,
              createdBy: 1,
            })
            .returning({ id: sales.id });

          // Sale items
          await db.insert(saleItems).values(items.map((it) => ({ ...it, saleId: sale.id, createdAt: dateStr })));

          // Payment
          await db.insert(payments).values({
            saleId: sale.id,
            customerId: customer.id,
            amount: String(total.toFixed(2)),
            currency: 'USD',
            paymentMethod: 'cash',
            paymentDate: dateStr,
            notes: 'دفع كامل',
            createdAt: dateStr,
            createdBy: 1,
          });
        }

        saleCount++;
      }
    }

    console.log(`  ✓ ${saleCount} sales generated over 4 months`);
    console.log('\n🌱 Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

seed();
