import { getDb, saveDatabase } from './db.js';
import {
  customers,
  categories,
  products,
  sales,
  saleItems,
  payments,
  installments,
  users,
} from './models/index.js';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// --- Helpers ---
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max) => Number((Math.random() * (max - min) + min).toFixed(2));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickMultiple = (arr, count) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

const randomDate = (start, end) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

const formatDate = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

// --- Data Generators ---

const generateCategories = () => [
  { name: 'هواتف ذكية', description: 'أحدث الهواتف من آبل وسامسونج وغيرها' },
  { name: 'حواسيب محمولة', description: 'لابتوبات للأعمال والألعاب' },
  { name: 'إكسسوارات', description: 'شواحن، سماعات، وكفرات' },
  { name: 'أجهزة منزلية', description: 'خلاطات، مكانس، أدوات مطبخ' },
  { name: 'مواد غذائية', description: 'رز، زيت، معلبات' },
  { name: 'ملابس رجالية', description: 'قمصان، بنطال، أحذية' },
  { name: 'أدوات كهربائية', description: 'توصيلات، مصابيح، بطاريات' },
];

const generateProducts = (categoryIds) => {
  const productsList = [];
  const brands = ['Apple', 'Samsung', 'Sony', 'Dell', 'LG', 'Nike', 'Adidas', 'Bosch'];

  // Phone/Laptop items
  productsList.push(
    { name: 'iPhone 15 Pro', cat: 'هواتف ذكية', price: 1200, cost: 1000 },
    { name: 'Samsung S24 Ultra', cat: 'هواتف ذكية', price: 1150, cost: 950 },
    { name: 'MacBook Air M2', cat: 'حواسيب محمولة', price: 1100, cost: 900 },
    { name: 'Dell XPS 15', cat: 'حواسيب محمولة', price: 1300, cost: 1100 },
    { name: 'AirPods Pro 2', cat: 'إكسسوارات', price: 250, cost: 180 },
    { name: 'Samsung Charger 45W', cat: 'إكسسوارات', price: 40, cost: 20 }
  );

  // Home & Grocery
  productsList.push(
    { name: 'خلاط Philips', cat: 'أجهزة منزلية', price: 80, cost: 50 },
    { name: 'مكنسة Panasonic', cat: 'أجهزة منزلية', price: 120, cost: 85 },
    { name: 'رز بسمتي 10كغ', cat: 'مواد غذائية', price: 18, cost: 12 },
    { name: 'زيت دوار الشمس 1لتر', cat: 'مواد غذائية', price: 3, cost: 2 },
    { name: 'شاي هيل 500غ', cat: 'مواد غذائية', price: 5, cost: 3 }
  );

  // Create generic products to fill up
  for (let i = 1; i <= 30; i++) {
    productsList.push({
      name: `منتج عام ${i}`,
      cat: 'أدوات كهربائية',
      price: randomInt(10, 100),
      cost: randomInt(5, 80),
    });
  }

  return productsList.map((p, idx) => {
    const catId = categoryIds[p.cat] || Object.values(categoryIds)[0];
    return {
      name: p.name,
      sku: `SKU-${1000 + idx}`,
      barcode: `${100000000000 + idx}`,
      categoryId: catId,
      description: `وصف للمنتج ${p.name}`,
      costPrice: p.cost,
      sellingPrice: p.price,
      currency: 'USD',
      stock: randomInt(10, 100),
      minStock: 5,
      unit: 'piece',
      supplier: pick(brands),
      status: 'available',
    };
  });
};

const generateCustomers = () => {
  const names = [
    'أحمد علي',
    'سارة حسن',
    'محمد رضا',
    'زينب كاظم',
    'حيدر الجبوري',
    'نور الدين',
    'فاطمة الزهراء',
    'حسين كريم',
    'مريم العبيدي',
    'علي المحمداوي',
    'يوسف عمر',
    'هدى جميل',
    'كرار حيدر',
    'سماح وليد',
    'مصطفى سعد',
  ];
  return names.map((name, idx) => ({
    name,
    phone: `07${pick(['7', '8', '9'])}${randomInt(10000000, 99999999)}`,
    address: `بغداد - منطقة ${randomInt(1, 20)}`,
    city: 'بغداد',
    notes: idx % 3 === 0 ? 'مفضل للأقساط' : 'زبون نقدي',
  }));
};

// --- Main Seed Function ---

async function seed() {
  console.log('🌱 Starting comprehensive database seeding...\n');

  try {
    const db = await getDb();

    // 0. Ensure Admin User exists
    const usersCount = await db
      .select({ count: sql`count(*)` })
      .from(users)
      .get();
    if (Number(usersCount.count) === 0) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await db.insert(users).values({
        username: 'admin',
        password: hashedPassword,
        fullName: 'مدير النظام',
        role: 'admin',
        phone: '07700000000',
      });
      console.log('✓ Admin user created');
    }

    // CLEANUP: Delete in correct order to avoid FK errors
    console.log('🧹 Cleaning up old data...');
    await db.delete(installments);
    await db.delete(payments);
    await db.delete(saleItems);
    await db.delete(sales);
    await db.delete(products);
    await db.delete(customers);
    await db.delete(categories); // Now safe to delete
    console.log('✓ Old data cleared');

    // 1. Categories
    console.log('→ Inserting categories...');
    const insertedCats = await db.insert(categories).values(generateCategories()).returning();
    const catMap = insertedCats.reduce((acc, c) => ({ ...acc, [c.name]: c.id }), {});
    console.log(`✓ Inserted ${insertedCats.length} categories`);

    // 2. Products
    console.log('→ Inserting products...');
    const insertedProducts = await db.insert(products).values(generateProducts(catMap)).returning();
    console.log(`✓ Inserted ${insertedProducts.length} products`);

    // 3. Customers
    console.log('→ Inserting customers...');
    const insertedCustomers = await db.insert(customers).values(generateCustomers()).returning();
    console.log(`✓ Inserted ${insertedCustomers.length} customers`);

    // 4. Sales History (Past 6 Months)
    console.log('→ Generating historical sales (this may take a moment)...');

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    const today = new Date();

    let saleCount = 0;
    let invoiceCounter = 1000;

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      // Randomly skip some days or have fewer sales
      const dailySalesCount = randomInt(0, 5);

      for (let i = 0; i < dailySalesCount; i++) {
        invoiceCounter++;
        const currentDateStr = formatDate(d);
        const isInstallment = Math.random() > 0.7; // 30% installment sales
        const customer = pick(insertedCustomers);

        // Pick random products
        const saleProducts = pickMultiple(insertedProducts, randomInt(1, 4));

        let subtotal = 0;
        const itemsToInsert = [];

        saleProducts.forEach((p) => {
          const qty = randomInt(1, 2);
          const lineTotal = p.sellingPrice * qty;
          subtotal += lineTotal;
          itemsToInsert.push({
            productId: p.id,
            productName: p.name,
            quantity: qty,
            unitPrice: p.sellingPrice,
            subtotal: lineTotal,
            discount: 0,
            createdAt: currentDateStr,
          });
        });

        const discount = Math.random() > 0.8 ? randomInt(5, 20) : 0;
        let total = subtotal - discount;
        let saleId;

        // Insert Sale
        if (isInstallment) {
          const interestRate = 5; // 5% interest
          const interestAmount = (total * interestRate) / 100;
          total += interestAmount;

          const downPayment = Math.floor(total * 0.3); // 30% down
          const remaining = total - downPayment;

          const res = await db
            .insert(sales)
            .values({
              invoiceNumber: `INV-${invoiceCounter}`,
              customerId: customer.id,
              subtotal,
              discount,
              total: Number(total.toFixed(2)),
              currency: 'USD',
              paymentType: 'installment',
              paidAmount: downPayment,
              remainingAmount: remaining,
              interestRate,
              interestAmount,
              status: remaining < 1 ? 'completed' : 'pending',
              createdAt: currentDateStr,
              updatedAt: currentDateStr,
              createdBy: 1,
            })
            .returning({ id: sales.id });
          saleId = res[0].id;

          // Initial Payment
          await db.insert(payments).values({
            saleId,
            customerId: customer.id,
            amount: downPayment,
            currency: 'USD',
            paymentMethod: 'cash',
            paymentDate: currentDateStr,
            notes: 'دفعة أولى',
            createdAt: currentDateStr,
          });

          // Generate 3 Installments
          const installmentAmount = Number((remaining / 3).toFixed(2));
          for (let k = 1; k <= 3; k++) {
            const dueDate = new Date(d);
            dueDate.setMonth(dueDate.getMonth() + k);
            const isPaid = dueDate < today; // If due date passed, assume paid for simulation

            await db.insert(installments).values({
              saleId,
              customerId: customer.id,
              installmentNumber: k,
              dueAmount: installmentAmount,
              paidAmount: isPaid ? installmentAmount : 0,
              remainingAmount: isPaid ? 0 : installmentAmount,
              currency: 'USD',
              dueDate: formatDate(dueDate),
              paidDate: isPaid ? formatDate(dueDate) : null,
              status: isPaid ? 'paid' : 'pending',
              createdAt: currentDateStr,
            });

            if (isPaid) {
              // Add payment record for installment
              await db.insert(payments).values({
                saleId,
                customerId: customer.id,
                amount: installmentAmount,
                currency: 'USD',
                paymentMethod: 'cash',
                paymentDate: formatDate(dueDate),
                notes: `قسط رقم ${k}`,
                createdAt: formatDate(dueDate),
              });
            }
          }
        } else {
          // Cash Sale
          const res = await db
            .insert(sales)
            .values({
              invoiceNumber: `INV-${invoiceCounter}`,
              customerId: customer.id,
              subtotal,
              discount,
              total: Number(total.toFixed(2)),
              currency: 'USD',
              paymentType: 'cash',
              paidAmount: total,
              remainingAmount: 0,
              status: 'completed',
              createdAt: currentDateStr,
              updatedAt: currentDateStr,
              createdBy: 1,
            })
            .returning({ id: sales.id });
          saleId = res[0].id;

          await db.insert(payments).values({
            saleId,
            customerId: customer.id,
            amount: total,
            currency: 'USD',
            paymentMethod: 'cash',
            paymentDate: currentDateStr,
            notes: 'دفع كامل',
            createdAt: currentDateStr,
          });
        }

        // Insert Items
        await db.insert(saleItems).values(itemsToInsert.map((i) => ({ ...i, saleId })));
        saleCount++;
      }
    }
    console.log(`✓ Generated ${saleCount} sales over the last 6 months`);

    // Save DB
    saveDatabase();
    console.log('\n🌱 Database seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database seeding failed:', err);
    process.exit(1);
  }
}

seed();
