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
import {
  getProductUnits,
  getDefaultSaleUnit,
  getUnitConversionFactor,
  getUnitSalePrice,
  getUnitCostPrice,
  getUnitAvailableStock,
  toBaseQuantity,
  calculateUnitProfit,
} from '@/utils/productUnits';

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

  // ── Unit helpers ─────────────────────────────────────────────────────────
  // Re-exported from utils/productUnits via wrappers so the existing
  // composable contract stays intact for callers that may have imported
  // them historically.
  const resolveUnits = (p) => getProductUnits(p);
  const pickDefaultUnit = (units) => {
    if (!Array.isArray(units) || units.length === 0) return null;
    return (
      units.find((u) => u.isDefaultSale && u.isActive !== false) ||
      units.find((u) => u.isBase) ||
      units[0] ||
      null
    );
  };

  // ── Cart actions ─────────────────────────────────────────────────────────
  /**
   * Add a product to the cart, optionally pre-selecting a unit (e.g. when a
   * carton barcode was scanned). Stock is always tracked in base units —
   * `availableStock` is the count in the SELECTED unit; the per-line
   * `baseAvailableStock` is the warehouse base count, kept around so we can
   * re-derive `availableStock` instantly when the user switches the unit.
   *
   * `basePrice` / `baseCostPrice` are the per-base-unit numbers from the
   * product row. They never change after the line is created — only the
   * derived `price` (per selected unit) does, so unit switches stay correct
   * even when the unit has no explicit salePrice override.
   */
  const addItem = (product, qty = 1, unitOverride = null) => {
    if (!product?.id) return;
    const baseAvailable = resolveStock(product);
    if (baseAvailable <= 0) {
      notify.warning(`"${product.name}" غير متوفر`);
      return;
    }

    const units = resolveUnits(product);
    const selectedUnit = unitOverride || pickDefaultUnit(units);
    const factor = getUnitConversionFactor(selectedUnit);
    const unitAvailable = getUnitAvailableStock(baseAvailable, selectedUnit);

    const existing = items.find(
      (i) => i.productId === product.id && (i.unitId || null) === (selectedUnit?.id || null)
    );
    if (existing) {
      const nextQty = existing.qty + qty;
      if (unitAvailable > 0 && nextQty > unitAvailable) {
        existing.qty = unitAvailable;
        notify.warning(
          `الكمية المتوفرة غير كافية لهذه الوحدة. المتاح: ${unitAvailable} ${selectedUnit?.name || ''}`.trim()
        );
        return;
      }
      existing.qty = nextQty;
      return;
    }

    const basePrice = Number(product.sellingPrice) || 0;
    const baseCostPrice = Number(product.costPrice) || 0;
    const unitPrice = getUnitSalePrice(product, selectedUnit);

    items.push({
      id: nextId(product.id),
      productId: product.id,
      name: product.name,
      sku: product.sku || null,
      barcode: product.barcode || null,
      // Per-base-unit numbers. Frozen for the lifetime of the line — used as
      // the source of truth when the user switches units.
      basePrice,
      baseCostPrice,
      // Per-selected-unit numbers. Recomputed by updateLineUnit().
      price: unitPrice,
      originalPrice: unitPrice,
      originalCurrency: product.currency || currency.value,
      qty: Math.min(qty, unitAvailable > 0 ? unitAvailable : qty),
      discount: 0,
      note: '',
      currency: currency.value,
      // Stock caps. baseAvailableStock NEVER changes after add; availableStock
      // is the derived per-selected-unit count and recomputes when the unit
      // (or a refresh of stock) changes.
      availableStock: unitAvailable,
      baseAvailableStock: baseAvailable,
      // Unit snapshot — drives the picker and persists onto the API payload.
      unitId: selectedUnit?.id || null,
      unitName: selectedUnit?.name || null,
      unitConversionFactor: factor,
      // Snapshot of the product's units (and base price/cost) so the line
      // can re-price without re-fetching the product after the user picks
      // a different unit.
      units,
    });
  };

  /**
   * Switch the unit on a cart line. Re-prices using the unit's salePrice
   * override when present, otherwise basePrice × the new factor. Resets the
   * per-unit available cap and clamps qty downward when the new unit's cap
   * is smaller than the current qty.
   */
  const updateLineUnit = (id, newUnitId) => {
    const row = findItem(id);
    if (!row) return;
    const newUnit = (row.units || []).find((u) => u.id === newUnitId) || null;
    const factor = getUnitConversionFactor(newUnit);

    row.unitId = newUnit?.id || null;
    row.unitName = newUnit?.name || null;
    row.unitConversionFactor = factor;

    // Re-price using basePrice (per BASE unit) — never rely on the previous
    // line price, which was already scaled to the OLD unit and would compound
    // the conversion error.
    const productLike = {
      sellingPrice: Number(row.basePrice) || 0,
      costPrice: Number(row.baseCostPrice) || 0,
    };
    row.price = getUnitSalePrice(productLike, newUnit);
    row.originalPrice = row.price;
    // Reset any per-unit discount: a discount that made sense for قطعة is
    // almost never the right number for درزن, and silently re-applying it
    // overcharges or undercharges the customer.
    row.discount = 0;

    // Re-derive per-unit availability from the immutable base cap.
    const baseAvailable = Number(row.baseAvailableStock) || 0;
    row.availableStock = getUnitAvailableStock(baseAvailable, newUnit);
    if (row.availableStock > 0 && row.qty > row.availableStock) {
      row.qty = row.availableStock;
      notify.warning(
        `الكمية المتوفرة غير كافية لهذه الوحدة. المتاح: ${row.availableStock} ${row.unitName || ''}`.trim()
      );
    }
  };

  const removeItem = (id) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx !== -1) items.splice(idx, 1);
  };

  /**
   * Update qty with clamp-on-commit semantics. Returns the final applied
   * quantity so the caller can sync a local input if needed. Validates
   * against the per-selected-unit cap (e.g. "كم درزن متوفر?") so the cap
   * stays consistent after the user switches the line's unit.
   */
  const updateQty = (id, rawQty) => {
    const row = findItem(id);
    if (!row) return null;
    const n = Math.max(1, Math.floor(Number(rawQty) || 1));
    if (row.availableStock > 0 && n > row.availableStock) {
      row.qty = row.availableStock;
      notify.warning(
        `الكمية المتوفرة غير كافية لهذه الوحدة. المتاح: ${row.availableStock} ${row.unitName || ''}`.trim()
      );
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

  /**
   * Live cart profit preview: per-line profit using the *currently selected*
   * unit's price/cost (with overrides honoured). Updates instantly when the
   * cashier switches a line's unit because the calc reads the per-unit
   * fields, not the persisted sale snapshot.
   */
  const lineProfit = (item) => {
    const unitLike = {
      conversionFactor: Number(item.unitConversionFactor) || 1,
      // The cart line stores `price` as the EFFECTIVE per-unit price (override
      // honoured); to drive calculateUnitProfit's "salePrice override" branch
      // we treat that as the unit's salePrice.
      salePrice: Number(item.price) || 0,
      // Cost is derived from the per-base cost — there's no per-unit cost
      // override on cart lines (cost overrides only ever live on the unit
      // row in the product catalogue).
      costPrice: null,
    };
    const productLike = {
      sellingPrice: Number(item.basePrice) || 0,
      costPrice: Number(item.baseCostPrice) || 0,
    };
    return calculateUnitProfit(item.qty, unitLike, productLike, item.discount);
  };
  const totalProfit = computed(() => items.reduce((s, it) => s + lineProfit(it), 0));

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
        unitId: i.unitId || null,
        // Snapshot fields — the backend re-validates the conversionFactor
        // from the DB, but sending them lets the API surface render the
        // exact unit chosen by the cashier (and lets the request schema
        // double-check the cashier's intent against the persisted unit).
        unitName: i.unitName || null,
        unitConversionFactor: Number(i.unitConversionFactor) || 1,
        baseQuantity: toBaseQuantity(i.qty, {
          conversionFactor: Number(i.unitConversionFactor) || 1,
        }),
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

  /**
   * Hydrate the cart from a server-side draft sale record.
   * Prevents duplicate hydration: a non-empty cart is left untouched.
   * Skips items whose product cannot be found in the supplied list.
   *
   * @param {Object} draft - Sale row returned by the backend (status === 'draft').
   * @param {Array<Object>} [productList] - Current product catalogue, used to
   *   resolve names/SKUs/stock so the cart line renders correctly. Optional —
   *   if omitted, falls back to fields stored on the draft item itself.
   */
  const loadDraft = (draft, productList = []) => {
    if (!draft || !Array.isArray(draft.items)) return false;
    if (items.length > 0) return false;

    if (draft.currency) currency.value = draft.currency;
    if (draft.customerId !== undefined) customerId.value = draft.customerId || null;
    if (draft.notes) notes.value = String(draft.notes);

    const findProduct = (id) =>
      Array.isArray(productList) ? productList.find((p) => p.id === id) : null;

    for (const it of draft.items) {
      if (!it?.productId) continue;
      const product = findProduct(it.productId);

      const name = product?.name || it.productName || `#${it.productId}`;
      const price = Number(it.unitPrice) || 0;
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const baseAvailable = product ? resolveStock(product) : 0;

      // Re-resolve the unit from the live product catalogue so the picker
      // has the full unit list (the draft only persists the chosen unit's
      // id / name). Falls back to the product's default sale unit when
      // the originally chosen unit no longer exists.
      const productUnits = getProductUnits(product);
      const draftUnit =
        productUnits.find((u) => u.id === it.unitId) ||
        getDefaultSaleUnit(product);
      const factor = getUnitConversionFactor(draftUnit);
      const unitAvailable = product ? getUnitAvailableStock(baseAvailable, draftUnit) : qty;

      items.push({
        id: nextId(it.productId),
        productId: it.productId,
        name,
        sku: product?.sku || null,
        barcode: product?.barcode || null,
        basePrice: Number(product?.sellingPrice) || price / (factor || 1),
        baseCostPrice: Number(product?.costPrice) || 0,
        price,
        originalPrice: Number(product?.sellingPrice) || price,
        originalCurrency: product?.currency || currency.value,
        qty: Math.min(qty, unitAvailable > 0 ? unitAvailable : qty),
        discount: Number(it.discount) || 0,
        note: it.note ? String(it.note) : '',
        currency: currency.value,
        availableStock: unitAvailable,
        baseAvailableStock: baseAvailable,
        unitId: draftUnit?.id || it.unitId || null,
        unitName: draftUnit?.name || it.unitName || null,
        unitConversionFactor: factor,
        units: productUnits,
      });
    }

    if (draft.discount) {
      saleDiscount.type = 'amount';
      saleDiscount.value = Number(draft.discount) || 0;
    }
    if (draft.tax) {
      tax.enabled = true;
      tax.type = 'percent';
      tax.value = Number(draft.tax) || 0;
    }

    return true;
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
    lineProfit,
    totalProfit,

    // actions
    addItem,
    removeItem,
    updateQty,
    incQty,
    decQty,
    updatePrice,
    updateLineDiscount,
    updateLineNote,
    updateLineUnit,
    clear,
    applyExact,
    addToPaid,
    setPaid,
    resetPaid,
    submit,
    holdAsDraft,
    loadDraft,
    buildPayload,
  };
}
