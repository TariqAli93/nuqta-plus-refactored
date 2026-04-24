import { computed, reactive, ref } from 'vue';
import { useSaleStore } from '@/stores/sale';
import { useInventoryStore } from '@/stores/inventory';
import { useSettingsStore } from '@/stores/settings';
import { useNotificationStore } from '@/stores/notification';
import {
  SALE_SOURCE_POS,
  SALE_TYPE_CASH,
  PAYMENT_METHOD_CARD,
} from '@/constants/sales';

/**
 * POS cart + checkout state machine.
 *
 * Design notes
 *  - Top-level refs + reactive objects are returned directly; consumers
 *    destructure them and get automatic reactivity without `.value` in templates.
 *  - Totals are currency-aware (IQD has no sub-unit; USD has 2dp).
 *  - All mutations go through named actions so the view stays declarative.
 *
 * Cart item:   { id, productId, name, sku, barcode, price, qty, discount, note,
 *                currency, availableStock }
 * Payment:     { method, paidAmount, reference, notes, saveAsInstallment }
 */
export function usePosCart() {
  const saleStore = useSaleStore();
  const inventoryStore = useInventoryStore();
  const settingsStore = useSettingsStore();
  const notify = useNotificationStore();

  // ── State ────────────────────────────────────────────────────────────────
  const currency = ref(settingsStore.settings?.defaultCurrency || 'IQD');
  const customerId = ref(null);
  const notes = ref('');
  const submitting = ref(false);

  /** Cart lines. Reactive array so splice/push trigger updates. */
  const items = reactive([]);

  const saleDiscount = reactive({ type: 'amount', value: 0 }); // 'amount' | 'percent'
  const tax = reactive({ type: 'percent', value: 0, enabled: false });

  const payment = reactive({
    method: 'cash', // 'cash' | 'card' | 'bank_transfer'
    paidAmount: 0,
    reference: '',
    notes: '',
    saveAsInstallment: false,
  });

  // ── Rounding by currency ────────────────────────────────────────────────
  const roundCurrency = (n, cur = currency.value) => {
    const num = Number(n) || 0;
    if (cur === 'IQD') return Math.round(num); // store in integer IQD; backend enforces 250 multiples
    return Math.round(num * 100) / 100;
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const resolveStock = (p) =>
    Number(p?.warehouseStock ?? p?.totalStock ?? p?.stock ?? 0) || 0;

  const findItem = (id) => items.find((i) => i.id === id);

  const nextId = (productId) =>
    `${productId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // ── Cart actions ─────────────────────────────────────────────────────────
  const addItem = (product, qty = 1) => {
    if (!product?.id) return;
    const available = resolveStock(product);
    if (available <= 0) {
      notify.warning(`"${product.name}" غير متوفر`);
      return;
    }

    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      const nextQty = existing.qty + qty;
      if (nextQty > available) {
        existing.qty = available;
        notify.warning(`المتاح من "${product.name}" هو ${available}`);
        return;
      }
      existing.qty = nextQty;
      return;
    }

    items.push({
      id: nextId(product.id),
      productId: product.id,
      name: product.name,
      sku: product.sku || null,
      barcode: product.barcode || null,
      price: Number(product.sellingPrice) || 0,
      originalPrice: Number(product.sellingPrice) || 0,
      originalCurrency: product.currency || currency.value,
      qty: Math.min(qty, available),
      discount: 0,
      note: '',
      currency: currency.value,
      availableStock: available,
    });
  };

  const removeItem = (id) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx !== -1) items.splice(idx, 1);
  };

  /**
   * Update qty with clamp-on-commit semantics. Returns the final applied
   * quantity so the caller can sync a local input if needed.
   */
  const updateQty = (id, rawQty) => {
    const row = findItem(id);
    if (!row) return null;
    const n = Math.max(1, Math.floor(Number(rawQty) || 1));
    if (row.availableStock > 0 && n > row.availableStock) {
      row.qty = row.availableStock;
      notify.warning(`المتاح من "${row.name}" هو ${row.availableStock}`);
      return row.qty;
    }
    row.qty = n;
    return n;
  };

  const incQty = (id) => {
    const row = findItem(id);
    if (row) updateQty(id, row.qty + 1);
  };

  const decQty = (id) => {
    const row = findItem(id);
    if (!row) return;
    if (row.qty <= 1) removeItem(id);
    else updateQty(id, row.qty - 1);
  };

  const updatePrice = (id, price) => {
    const row = findItem(id);
    if (row) row.price = Math.max(0, Number(price) || 0);
  };

  const updateLineDiscount = (id, discount) => {
    const row = findItem(id);
    if (row) row.discount = Math.max(0, Number(discount) || 0);
  };

  const updateLineNote = (id, note) => {
    const row = findItem(id);
    if (row) row.note = String(note || '');
  };

  const clear = () => {
    items.splice(0, items.length);
    saleDiscount.type = 'amount';
    saleDiscount.value = 0;
    tax.type = 'percent';
    tax.value = 0;
    tax.enabled = false;
    payment.method = 'cash';
    payment.paidAmount = 0;
    payment.reference = '';
    payment.notes = '';
    payment.saveAsInstallment = false;
    customerId.value = null;
    notes.value = '';
  };

  // ── Totals ───────────────────────────────────────────────────────────────
  const lineSubtotal = (item) =>
    Math.max(
      0,
      (Number(item.price) - Number(item.discount || 0)) * Number(item.qty || 0)
    );

  const subtotal = computed(() => items.reduce((s, it) => s + lineSubtotal(it), 0));

  const discountValue = computed(() => {
    if (saleDiscount.type === 'percent') {
      return Math.max(0, (subtotal.value * (Number(saleDiscount.value) || 0)) / 100);
    }
    return Math.max(0, Number(saleDiscount.value) || 0);
  });

  const afterDiscount = computed(() => Math.max(0, subtotal.value - discountValue.value));

  const taxValue = computed(() => {
    if (!tax.enabled) return 0;
    if (tax.type === 'percent') {
      return (afterDiscount.value * (Number(tax.value) || 0)) / 100;
    }
    return Math.max(0, Number(tax.value) || 0);
  });

  const total = computed(() => roundCurrency(afterDiscount.value + taxValue.value));
  const paidAmount = computed(() => Math.max(0, Number(payment.paidAmount) || 0));
  const change = computed(() => Math.max(0, paidAmount.value - total.value));
  const remaining = computed(() => Math.max(0, total.value - paidAmount.value));
  const itemCount = computed(() => items.reduce((s, i) => s + i.qty, 0));

  /** Reason the checkout button is disabled (null when submittable). */
  const blockingReason = computed(() => {
    if (items.length === 0) return 'السلة فارغة';
    if (total.value <= 0) return 'الإجمالي صفر';
    if (remaining.value > 0) {
      if (!payment.saveAsInstallment) return 'المبلغ المستلم أقل من الإجمالي';
      if (!customerId.value) return 'اختر عميلاً لحفظ المتبقي كدَين';
    }
    return null;
  });

  const canSubmit = computed(() => blockingReason.value === null);

  // ── Quick payment actions ────────────────────────────────────────────────
  const applyExact = () => {
    payment.paidAmount = total.value;
  };

  const addToPaid = (amount) => {
    payment.paidAmount = roundCurrency(
      Math.max(0, (Number(payment.paidAmount) || 0) + Number(amount || 0))
    );
  };

  const setPaid = (value) => {
    payment.paidAmount = roundCurrency(Math.max(0, Number(value) || 0));
  };

  const resetPaid = () => {
    payment.paidAmount = 0;
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const buildPayload = () => {
    const taxPercent = tax.enabled && tax.type === 'percent' ? Number(tax.value) || 0 : 0;
    const isInstallment = payment.saveAsInstallment && remaining.value > 0;

    return {
      // ── v2 source / type ──────────────────────────────────────────────────
      saleSource: SALE_SOURCE_POS,
      saleType:   SALE_TYPE_CASH,
      // ── legacy field (kept for backend backward-compat) ───────────────────
      paymentType: 'cash',
      // ─────────────────────────────────────────────────────────────────────
      customerId: customerId.value || null,
      currency: currency.value,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.qty,
        unitPrice: Number(i.price) || 0,
        discount: Number(i.discount) || 0,
      })),
      discount: discountValue.value,
      tax: taxPercent,
      paidAmount: Math.min(paidAmount.value, total.value),
      paymentMethod: payment.method,
      paymentReference:
        payment.method === PAYMENT_METHOD_CARD
          ? (payment.reference?.trim() || null)
          : null,
      interestRate: 0,
      notes: notes.value ? String(notes.value) : undefined,
      paymentNotes: payment.notes ? String(payment.notes) : undefined,
      branchId: inventoryStore.selectedBranchId || undefined,
      warehouseId: inventoryStore.selectedWarehouseId || undefined,
    };
  };

  const submit = async () => {
    if (!canSubmit.value) return null;
    // Card payments must carry a non-empty reference before we even hit the API.
    if (payment.method === PAYMENT_METHOD_CARD && !payment.reference?.trim()) {
      notify.error('رقم مرجع البطاقة مطلوب');
      return null;
    }
    submitting.value = true;
    try {
      const response = await saleStore.createSale(buildPayload());
      return response?.data?.data || response?.data || response || null;
    } finally {
      submitting.value = false;
    }
  };

  const holdAsDraft = async () => {
    if (items.length === 0) return null;
    submitting.value = true;
    try {
      return await saleStore.createDraft(buildPayload());
    } finally {
      submitting.value = false;
    }
  };

  return {
    // state
    currency,
    customerId,
    notes,
    items,
    saleDiscount,
    tax,
    payment,
    submitting,

    // computed
    subtotal,
    discountValue,
    afterDiscount,
    taxValue,
    total,
    paidAmount,
    change,
    remaining,
    itemCount,
    canSubmit,
    blockingReason,
    lineSubtotal,

    // actions
    addItem,
    removeItem,
    updateQty,
    incQty,
    decQty,
    updatePrice,
    updateLineDiscount,
    updateLineNote,
    clear,
    applyExact,
    addToPaid,
    setPaid,
    resetPaid,
    submit,
    holdAsDraft,
    buildPayload,
  };
}
