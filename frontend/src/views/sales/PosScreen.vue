<template>
  <div class="pos" :class="{ 'is-mobile': isMobile, 'cart-open': cartOpen }">
    <!-- ═══════════════════ Products zone ═══════════════════ -->
    <section class="pos__products" aria-label="المنتجات">
      <header class="products__toolbar">
        <div class="toolbar__row">
          <v-text-field
            ref="searchRef"
            v-model="searchInput"
            density="comfortable"
            variant="outlined"
            hide-details
            placeholder="بحث سريع (F2)"
            prepend-inner-icon="mdi-magnify"
            clearable
            @keydown.esc.prevent="searchInput = ''"
            @keydown.down.prevent="focusFirstCard"
          />
          <v-text-field
            ref="barcodeRef"
            v-model="barcode"
            density="comfortable"
            variant="outlined"
            hide-details
            placeholder="باركود (F4)"
            prepend-inner-icon="mdi-barcode-scan"
            class="barcode-input"
            @keyup.enter="onBarcode"
            @keydown.esc.prevent="barcode = ''"
          />
          <button
            v-if="isMobile"
            type="button"
            class="cart-fab"
            :class="{ 'has-items': itemCount > 0 }"
            :aria-label="`السلة (${itemCount} صنف)`"
            @click="cartOpen = !cartOpen"
          >
            <v-icon size="22">{{ cartOpen ? 'mdi-close' : 'mdi-cart' }}</v-icon>
            <span v-if="!cartOpen" class="cart-fab__count">{{ itemCount }}</span>
          </button>
        </div>

        <div class="toolbar__chips" role="tablist" aria-label="التصنيفات">
          <button
            type="button"
            class="chip"
            :class="{ active: selectedCategory === null }"
            role="tab"
            :aria-selected="selectedCategory === null"
            @click="selectedCategory = null"
          >
            الكل
            <span class="chip__count">{{ products.length }}</span>
          </button>
          <button
            v-for="c in categoriesWithCounts"
            :key="c.id"
            type="button"
            class="chip"
            :class="{ active: selectedCategory === c.id }"
            role="tab"
            :aria-selected="selectedCategory === c.id"
            @click="selectedCategory = c.id"
          >
            {{ c.name }}
            <span class="chip__count">{{ c.count }}</span>
          </button>
        </div>
      </header>

      <div
        ref="gridRef"
        class="products__grid"
        role="grid"
        aria-live="polite"
        @keydown="onGridKey"
      >
        <template v-if="loadingProducts">
          <div
            v-for="n in 8"
            :key="`sk-${n}`"
            class="product product--skeleton"
            aria-hidden="true"
          />
        </template>

        <div v-else-if="filteredProducts.length === 0" class="products__empty">
          <v-icon size="56" class="text-medium-emphasis">mdi-package-variant-closed</v-icon>
          <div class="text-h6 mt-2">
            {{ debouncedSearch || selectedCategory ? 'لا نتائج' : 'لا توجد منتجات' }}
          </div>
          <div class="text-body-2 text-medium-emphasis">
            {{
              debouncedSearch || selectedCategory
                ? 'جرّب تعديل البحث أو التصنيف.'
                : 'أضف منتجات من شاشة المنتجات لبدء البيع.'
            }}
          </div>
        </div>

        <button
          v-for="p in filteredProducts"
          v-else
          :key="p.id"
          v-memo="[p.id, availableOf(p), p.sellingPrice, p.name, isFeatured(p)]"
          class="product"
          :class="{
            'product--out': availableOf(p) <= 0,
            'product--featured': isFeatured(p),
          }"
          :disabled="availableOf(p) <= 0"
          :title="p.name"
          :tabindex="availableOf(p) <= 0 ? -1 : 0"
          role="gridcell"
          @click="addProduct(p)"
          @keydown.enter.prevent="addProduct(p)"
          @keydown.space.prevent="addProduct(p)"
        >
          <span v-if="isFeatured(p)" class="product__badge" aria-label="مميّز">
            <v-icon size="14">mdi-star</v-icon>
          </span>
          <div class="product__name">{{ p.name }}</div>
          <div v-if="p.category" class="product__cat">{{ p.category }}</div>
          <div class="product__foot">
            <span class="product__price">{{ formatMoney(p.sellingPrice, p.currency) }}</span>
            <span class="product__stock" :class="stockClass(p)">{{ availableOf(p) }}</span>
          </div>
        </button>
      </div>
    </section>

    <!-- ═══════════════════ Cart zone ═══════════════════ -->
    <aside class="pos__cart" :class="{ 'is-open': cartOpen }" aria-label="السلة">
      <div v-if="isMobile" class="cart__handle" @click="cartOpen = false">
        <span class="cart__handle-bar" />
      </div>

      <!-- Header -->
      <header class="cart__header">
        <span class="cart__title-text">السلة</span>
        <div class="cart__header-end">
          <span v-if="itemCount > 0" class="cart__badge">{{ itemCount }} صنف</span>
          <v-btn
            v-if="items.length > 0"
            size="x-small"
            variant="text"
            color="error"
            class="cart__clear-btn"
            @click="confirmClear"
          >
            تفريغ
          </v-btn>
        </div>
      </header>

      <!-- Customer -->
      <div class="cart__customer">
        <CustomerSelector v-model="customerId" :required="false" />
      </div>

      <!-- Lines -->
      <div class="cart__lines" aria-live="polite">
        <div v-if="items.length === 0" class="cart__empty">
          <v-icon size="48" class="text-medium-emphasis">mdi-cart-outline</v-icon>
          <div class="text-body-1 mt-2 font-weight-medium">السلة فارغة</div>
          <div class="text-caption text-medium-emphasis">
            اختر منتجاً أو امسح باركود لبدء البيع.
          </div>
          <div class="cart__hints">
            <span class="cart__hint"><kbd>F2</kbd> بحث</span>
            <span class="cart__hint"><kbd>F4</kbd> باركود</span>
            <span class="cart__hint"><kbd>F9</kbd> دفع</span>
          </div>
        </div>

        <TransitionGroup v-else name="line-anim" tag="ul" class="cart__lines-list">
          <li
            v-for="item in items"
            :key="item.id"
            class="line"
            :class="{ 'line--flash': flashItemId === item.id }"
          >
            <!-- Name + breakdown (clickable to edit) -->
            <div
              class="line__info"
              role="button"
              tabindex="0"
              @click="openLineEdit(item)"
              @keydown.enter.prevent="openLineEdit(item)"
            >
              <div class="line__name" :title="item.name">{{ item.name }}</div>
              <div class="line__breakdown">
                {{ item.qty }} × {{ formatMoney(Math.max(0, item.price - item.discount), currency) }}
                <span v-if="item.discount > 0" class="line__chip line__chip--warning">
                  <v-icon size="10">mdi-tag-outline</v-icon>
                  خصم
                </span>
                <span v-if="item.note" class="line__chip line__chip--note" :title="item.note">
                  {{ truncate(item.note, 10) }}
                </span>
              </div>
            </div>

            <!-- Qty stepper: + qty − -->
            <div class="qty">
              <button type="button" class="qty__btn" aria-label="زيادة" @click="incQty(item.id)">
                <v-icon size="14">mdi-plus</v-icon>
              </button>
              <input
                :value="item.qty"
                type="number"
                min="1"
                class="qty__input"
                inputmode="numeric"
                @blur="(e) => commitQty(item.id, e.target.value)"
                @keyup.enter="(e) => { commitQty(item.id, e.target.value); e.target.blur(); }"
              />
              <button type="button" class="qty__btn" aria-label="إنقاص" @click="decQty(item.id)">
                <v-icon size="14">mdi-minus</v-icon>
              </button>
            </div>

            <!-- Line subtotal -->
            <div class="line__subtotal">
              {{ formatMoney(lineSubtotal(item), currency) }}
            </div>

            <!-- Remove -->
            <button
              type="button"
              class="line__remove"
              :aria-label="`إزالة ${item.name}`"
              @click="removeItem(item.id)"
            >
              <v-icon size="15">mdi-close</v-icon>
            </button>
          </li>
        </TransitionGroup>
      </div>

      <!-- ── Payment method tabs ──────────────────────────── -->
      <div class="pay__methods" role="radiogroup" aria-label="طريقة الدفع">
        <button
          v-for="m in paymentMethods"
          :key="m.value"
          type="button"
          class="pay__method"
          :class="{ active: payment.method === m.value }"
          role="radio"
          :aria-checked="payment.method === m.value"
          @click="payment.method = m.value"
        >
          <v-icon size="20">{{ m.icon }}</v-icon>
          <span>{{ m.label }}</span>
        </button>
      </div>

      <!-- ── Paid amount + quick actions (makes checkout faster) ──────────── -->
      <div v-if="items.length > 0" class="pay__paid">
        <div class="pay__paid-top">
          <div class="pay__paid-title">
            <span class="pay__paid-label">المستلم</span>
            <span class="pay__paid-sub text-caption text-medium-emphasis">
              {{ changeLabel }}
            </span>
          </div>

          <div class="pay__paid-actions">
            <button type="button" class="pay__mini" @click="applyExact">بالضبط</button>
            <button type="button" class="pay__mini" @click="resetPaid">تصفير</button>
            <button
              type="button"
              class="pay__mini pay__mini--adv"
              :aria-expanded="adjustmentsOpen"
              @click="adjustmentsOpen = !adjustmentsOpen"
            >
              خيارات
              <span v-if="adjSummary" class="pay__mini-hint">{{ adjSummary }}</span>
            </button>
          </div>
        </div>

        <div class="pay__paid-row">
          <v-text-field
            v-model.number="payment.paidAmount"
            type="number"
            min="0"
            variant="outlined"
            density="comfortable"
            hide-details
            class="pay__paid-input"
            :placeholder="currency === 'USD' ? '0.00' : '0'"
            @blur="(e) => setPaid(e.target.value)"
          />
          <div class="pay__delta" :class="changeStateClass">
            <span class="pay__delta-value">{{ formatMoney(changeAmount, currency) }}</span>
          </div>
        </div>

        <div v-if="payment.method === 'cash'" class="pay__quick">
          <button
            v-for="a in quickAmounts"
            :key="a"
            type="button"
            class="pay__quick-btn"
            @click="addToPaid(a)"
          >
            + {{ formatMoney(a, currency) }}
          </button>
        </div>

        <div v-if="payment.method !== 'cash'" class="pay__refs">
          <v-text-field
            v-model="payment.reference"
            variant="outlined"
            density="comfortable"
            hide-details
            label="مرجع العملية (اختياري)"
          />
        </div>

        <div class="pay__installment">
          <label class="pay__installment-row">
            <input v-model="payment.saveAsInstallment" type="checkbox" />
            <span>حفظ المتبقي كدَين (يتطلب اختيار عميل)</span>
          </label>
        </div>

        <Transition name="line-anim">
          <div v-if="adjustmentsOpen" class="pay__adjustments">
            <div class="pay__adjust-grid">
              <v-text-field
                v-model.number="saleDiscount.value"
                type="number"
                min="0"
                variant="outlined"
                density="comfortable"
                hide-details
                label="خصم"
              />
              <div class="pay__seg">
                <button
                  type="button"
                  class="pay__seg-btn"
                  :class="{ active: saleDiscount.type === 'amount' }"
                  @click="saleDiscount.type = 'amount'"
                >
                  مبلغ
                </button>
                <button
                  type="button"
                  class="pay__seg-btn"
                  :class="{ active: saleDiscount.type === 'percent' }"
                  @click="saleDiscount.type = 'percent'"
                >
                  %
                </button>
              </div>

              <v-text-field
                v-model.number="tax.value"
                type="number"
                min="0"
                variant="outlined"
                density="comfortable"
                hide-details
                :label="tax.type === 'percent' ? 'ضريبة %' : 'ضريبة'"
                :disabled="!tax.enabled"
              />
              <label class="pay__toggle">
                <input v-model="tax.enabled" type="checkbox" />
                <span>تفعيل الضريبة</span>
              </label>
            </div>
          </div>
        </Transition>
      </div>

      <!-- ── Summary + Total ────────────────────────────── -->
      <div class="pay__summary">
        <div
          v-if="items.length > 0 && (discountValue > 0 || taxValue > 0)"
          class="pay__summary-rows"
        >
          <div class="pay__summary-row">
            <span class="pay__summary-value">{{ formatMoney(subtotal, currency) }}</span>
            <span class="pay__summary-label">المجموع الفرعي</span>
          </div>
          <div v-if="discountValue > 0" class="pay__summary-row">
            <span class="pay__summary-value pay__summary-value--discount">
              {{ formatMoney(discountValue, currency) }} −
            </span>
            <span class="pay__summary-label">الخصم</span>
          </div>
          <div v-if="taxValue > 0" class="pay__summary-row">
            <span class="pay__summary-value">{{ formatMoney(taxValue, currency) }}</span>
            <span class="pay__summary-label">الضريبة (%{{ tax.value }})</span>
          </div>
        </div>

        <div class="pay__total-row">
          <span class="pay__total-value">{{ formatMoney(total, currency) }}</span>
          <span class="pay__total-label">الإجمالي</span>
        </div>
      </div>

      <!-- ── Blocking hint ──────────────────────────────── -->
      <div v-if="blockingReason" class="pay__hint">
        <v-icon size="16">mdi-information-outline</v-icon>
        {{ blockingReason }}
      </div>

      <!-- ── Actions ────────────────────────────────────── -->
      <div class="pay__actions">
        <v-btn
          variant="outlined"
          size="large"
          class="pay__draft-btn"
          :disabled="items.length === 0 || submitting"
          @click="onHold"
        >
          حفظ كمسودة
        </v-btn>
        <v-btn
          size="large"
          color="primary"
          class="pay__checkout"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="checkout"
        >
          <v-icon start size="18">mdi-check-circle-outline</v-icon>
          دفع وإتمام
          <span class="pay__hotkey">(F9)</span>
        </v-btn>
      </div>
    </aside>

    <!-- ═══════════════════ Overlays ═══════════════════ -->
    <div
      v-if="isMobile && cartOpen"
      class="pos__backdrop"
      @click="cartOpen = false"
    />

    <!-- Line edit dialog (per-unit discount + note) -->
    <v-dialog v-model="lineEditOpen" max-width="440">
      <v-card v-if="lineEditItem" class="line-edit">
        <v-card-title class="line-edit__title">
          <div class="line-edit__name">{{ lineEditItem.name }}</div>
          <div class="line-edit__price text-caption text-medium-emphasis">
            السعر: {{ formatMoney(lineEditItem.price, currency) }}
          </div>
        </v-card-title>
        <v-card-text class="line-edit__body">
          <v-text-field
            v-model.number="lineEditDraft.discount"
            type="number"
            min="0"
            label="خصم / وحدة"
            variant="outlined"
            density="comfortable"
            hide-details
            :max="lineEditItem.price"
          />
          <v-text-field
            v-model="lineEditDraft.note"
            label="ملاحظة"
            variant="outlined"
            density="comfortable"
            hide-details
            autofocus
          />
        </v-card-text>
        <v-card-actions class="line-edit__actions">
          <v-btn variant="text" @click="lineEditOpen = false">إلغاء</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="saveLineEdit">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="clearDialog"
      title="تفريغ السلة"
      message="هل تريد إزالة كل المنتجات من السلة؟"
      type="warning"
      confirm-text="تفريغ"
      cancel-text="إلغاء"
      @confirm="clear"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import {
  useProductStore,
  useCategoryStore,
  useInventoryStore,
  useSettingsStore,
  useNotificationStore,
} from '@/stores';
import { usePosCart } from '@/composables/usePosCart';
import CustomerSelector from '@/components/CustomerSelector.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

// ── Stores ──────────────────────────────────────────────────────────────────
const productStore = useProductStore();
const categoryStore = useCategoryStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();
const notify = useNotificationStore();
const router = useRouter();

const { mobile: isMobile } = useDisplay();

// ── Cart composable ────────────────────────────────────────────────────────
const {
  currency,
  customerId,
  items,
  saleDiscount,
  tax,
  payment,
  submitting,

  subtotal,
  discountValue,
  taxValue,
  total,
  change,
  remaining,
  itemCount,
  canSubmit,
  blockingReason,
  lineSubtotal,

  addItem,
  removeItem,
  updateQty,
  incQty,
  decQty,
  updateLineDiscount,
  updateLineNote,
  clear,
  applyExact,
  addToPaid,
  setPaid,
  resetPaid,
  submit,
  holdAsDraft,
} = usePosCart();

// ── Local UI state ─────────────────────────────────────────────────────────
const searchInput = ref('');
const debouncedSearch = ref('');
const barcode = ref('');
const selectedCategory = ref(null);
const products = ref([]);
const categories = ref([]);
const loadingProducts = ref(false);
const cartOpen = ref(false);
const clearDialog = ref(false);
const adjustmentsOpen = ref(true); // expanded on desktop, collapsed on mobile (set onMounted)

// Per-line edit dialog state
const lineEditOpen = ref(false);
const lineEditItem = ref(null);
const lineEditDraft = reactive({ discount: 0, note: '' });

// Flash effect: highlights a cart line when it's newly added or its qty grew —
// gives the cashier positive confirmation that their click/scan landed.
const flashItemId = ref(null);
const lastLineQty = new Map();
let flashTimer = null;

watch(
  items,
  (curr) => {
    let flashId = null;
    for (const it of curr) {
      const prevQty = lastLineQty.get(it.id);
      if (prevQty === undefined || it.qty > prevQty) flashId = it.id;
    }
    lastLineQty.clear();
    for (const it of curr) lastLineQty.set(it.id, it.qty);

    if (flashId) {
      flashItemId.value = flashId;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        if (flashItemId.value === flashId) flashItemId.value = null;
      }, 900);
    }
  },
  { deep: true, flush: 'post' }
);

const truncate = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

const searchRef = ref(null);
const barcodeRef = ref(null);
const gridRef = ref(null);

// Debounce search so rapid typing doesn't thrash the filter
let searchTimer = null;
watch(searchInput, (v) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = (v || '').trim().toLowerCase();
  }, 120);
});

// ── Payment UI config ──────────────────────────────────────────────────────
const paymentMethods = [
  { value: 'cash',          label: 'نقداً',   icon: 'mdi-cash' },
  { value: 'card',          label: 'بطاقة',   icon: 'mdi-credit-card-outline' },
  { value: 'bank_transfer', label: 'تحويل',   icon: 'mdi-bank-transfer' },
  { value: 'deferred',      label: 'دَمج',    icon: 'mdi-clock-outline' },
];

const quickAmounts = computed(() =>
  currency.value === 'USD'
    ? [1, 5, 10, 20, 50, 100]
    : [1000, 5000, 10000, 25000, 50000, 100000]
);

// ── Derived product helpers ────────────────────────────────────────────────
const availableOf = (p) =>
  Number(p?.warehouseStock ?? p?.totalStock ?? p?.stock ?? 0) || 0;

const stockClass = (p) => {
  const q = availableOf(p);
  if (q <= 0) return 'stock-out';
  const threshold =
    p.lowStockThreshold && p.lowStockThreshold > 0 ? p.lowStockThreshold : p.minStock || 0;
  if (q <= threshold) return 'stock-low';
  return 'stock-ok';
};

/** Featured flag is best-effort — falls back to `false` when the API doesn't provide it. */
const isFeatured = (p) =>
  Boolean(p?.isFeatured || p?.isBestSeller || p?.featured || p?.bestseller);

/** Products filtered by category + debounced search. Single pass. */
const filteredProducts = computed(() => {
  const q = debouncedSearch.value;
  const catId = selectedCategory.value;
  if (!q && !catId) return products.value;

  return products.value.filter((p) => {
    if (catId != null && p.categoryId !== catId) return false;
    if (!q) return true;
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
  });
});

/** Categories with counts; empty ones are hidden. */
const categoriesWithCounts = computed(() => {
  const counts = new Map();
  for (const p of products.value) {
    if (p.categoryId == null) continue;
    counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
  }
  return categories.value
    .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
    .filter((c) => c.count > 0);
});

// ── Payment derivations ────────────────────────────────────────────────────
const changeAmount = computed(() => (change.value > 0 ? change.value : remaining.value));
const changeLabel = computed(() => {
  if (change.value > 0) return 'الباقي للعميل';
  if (remaining.value > 0) return 'المتبقي';
  return 'التعادل';
});
const changeStateClass = computed(() => {
  if (change.value > 0) return 'is-success';
  if (remaining.value > 0) return 'is-error';
  return 'is-neutral';
});

const adjSummary = computed(() => {
  const parts = [];
  if (Number(saleDiscount.value) > 0) {
    parts.push(
      saleDiscount.type === 'percent'
        ? `خصم ${saleDiscount.value}%`
        : `خصم ${saleDiscount.value}`
    );
  }
  if (tax.enabled && Number(tax.value) > 0) parts.push(`ضريبة ${tax.value}%`);
  const method = paymentMethods.find((m) => m.value === payment.method);
  if (method) parts.push(method.label);
  return parts.join(' • ');
});

// ── Formatting ─────────────────────────────────────────────────────────────
const formatMoney = (value, cur) => {
  const n = Number(value || 0);
  const c = cur || currency.value;
  return `${n.toLocaleString('en-US', {
    maximumFractionDigits: c === 'USD' ? 2 : 0,
  })} ${c}`;
};

// ── Data load ──────────────────────────────────────────────────────────────
const loadProducts = async () => {
  loadingProducts.value = true;
  try {
    const response = await productStore.fetch({
      limit: 1000,
      warehouseId: inventoryStore.selectedWarehouseId || undefined,
    });
    products.value = response?.data || [];
  } finally {
    loadingProducts.value = false;
  }
};

const loadCategories = async () => {
  try {
    const response = await categoryStore.fetchCategories();
    categories.value = response?.data || [];
  } catch {
    categories.value = [];
  }
};

watch(() => inventoryStore.selectedWarehouseId, loadProducts);

// ── Cart interactions ──────────────────────────────────────────────────────
const addProduct = (product) => {
  if (availableOf(product) <= 0) return;
  addItem(product);
};

const commitQty = (id, raw) => {
  updateQty(id, raw);
};

const onBarcode = () => {
  const code = barcode.value.trim();
  if (!code) return;
  const match = products.value.find((p) => p.barcode === code || p.sku === code);
  if (!match) {
    notify.error('لا يوجد منتج بهذا الرمز');
    return;
  }
  addItem(match, 1);
  barcode.value = '';
  nextTick(() => barcodeRef.value?.focus?.());
};

const openLineEdit = (item) => {
  lineEditItem.value = item;
  lineEditDraft.discount = Number(item.discount) || 0;
  lineEditDraft.note = String(item.note || '');
  lineEditOpen.value = true;
};

const saveLineEdit = () => {
  const item = lineEditItem.value;
  if (!item) return;
  updateLineDiscount(item.id, lineEditDraft.discount);
  updateLineNote(item.id, lineEditDraft.note);
  lineEditOpen.value = false;
};

const checkout = async () => {
  if (!canSubmit.value) return;
  try {
    const sale = await submit();
    if (sale?.id) {
      notify.success('تم حفظ البيع بنجاح');
      clear();
      router.push({ name: 'SaleDetails', params: { id: sale.id } });
      return;
    }
    notify.success('تم حفظ البيع');
    clear();
  } catch (err) {
    notify.error(err?.message || 'فشل إتمام البيع');
  }
};

const onHold = async () => {
  try {
    const draft = await holdAsDraft();
    if (draft) {
      notify.success('تم حفظ المسودة');
      clear();
    }
  } catch (err) {
    notify.error(err?.message || 'فشل حفظ المسودة');
  }
};

const confirmClear = () => {
  clearDialog.value = true;
};

// ── Keyboard: global shortcuts ─────────────────────────────────────────────
const isEditable = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

const onKeydown = (e) => {
  // F-keys fire globally — they intentionally cross input focus.
  if (e.key === 'F2') {
    e.preventDefault();
    searchRef.value?.focus?.();
    return;
  }
  if (e.key === 'F4') {
    e.preventDefault();
    barcodeRef.value?.focus?.();
    return;
  }
  if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
    e.preventDefault();
    checkout();
    return;
  }
  if (isEditable(e.target)) return;
};

// ── Keyboard: grid roving focus ────────────────────────────────────────────
// Works in RTL: logical ArrowLeft moves to the NEXT card in reading order.
const focusFirstCard = () => {
  const first = gridRef.value?.querySelector('.product:not([disabled])');
  if (first) first.focus();
};

const gridCols = () => {
  const grid = gridRef.value;
  if (!grid) return 1;
  const tmpl = getComputedStyle(grid).gridTemplateColumns;
  return Math.max(1, tmpl.split(' ').filter(Boolean).length);
};

const onGridKey = (e) => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;

  const cards = Array.from(
    gridRef.value?.querySelectorAll('.product:not([disabled])') || []
  );
  if (cards.length === 0) return;

  const current = document.activeElement;
  let idx = cards.indexOf(current);
  if (idx < 0) idx = 0;

  const cols = gridCols();
  let next = idx;

  switch (e.key) {
    // RTL: visual "left" is the next item in reading order
    case 'ArrowLeft':
      next = idx + 1;
      break;
    case 'ArrowRight':
      next = idx - 1;
      break;
    case 'ArrowDown':
      next = idx + cols;
      break;
    case 'ArrowUp':
      next = idx - cols;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = cards.length - 1;
      break;
  }

  if (next < 0 || next >= cards.length) return;
  e.preventDefault();
  cards[next]?.focus();
};

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  adjustmentsOpen.value = !isMobile.value;

  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  await Promise.all([loadProducts(), loadCategories()]);

  try {
    const settings = await settingsStore.fetchCurrencySettings();
    if (settings?.defaultCurrency) currency.value = settings.defaultCurrency;
  } catch {
    /* keep default */
  }

  window.addEventListener('keydown', onKeydown);
  nextTick(() => barcodeRef.value?.focus?.());
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(searchTimer);
  clearTimeout(flashTimer);
});
</script>

<style scoped lang="scss">
/* ══════════════════ Design tokens (local) ══════════════════
 * Align with the project's 8px rhythm. Using local custom-properties so we
 * can override per-breakpoint without touching global styles.
 */
.pos {
  --pos-space-1: 4px;
  --pos-space-2: 8px;
  --pos-space-3: 12px;
  --pos-space-4: 16px;
  --pos-space-6: 24px;
  --pos-radius-sm: 8px;
  --pos-radius-md: 12px;
  --pos-radius-lg: 16px;
  --pos-surface: rgb(var(--v-theme-surface));
  --pos-surface-soft: rgba(var(--v-theme-on-surface), 0.04);
  --pos-surface-tint: rgba(var(--v-theme-on-surface), 0.06);
  --pos-border: rgba(var(--v-theme-on-surface), 0.08);
  --pos-border-strong: rgba(var(--v-theme-on-surface), 0.14);
  --pos-primary: rgb(var(--v-theme-primary));
  --pos-primary-soft: rgba(var(--v-theme-primary), 0.08);
  --pos-primary-hover: rgba(var(--v-theme-primary), 0.14);

  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  gap: var(--pos-space-4);
  height: calc(100vh - 120px);
  min-height: 600px;
  direction: rtl;
}

.pos__products,
.pos__cart {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--pos-surface);
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-lg);
  overflow: hidden;
}

/* ══════════════════ Products toolbar ══════════════════ */
.products__toolbar {
  padding: var(--pos-space-3) var(--pos-space-4) var(--pos-space-2);
  border-bottom: 1px solid var(--pos-border);
  background: var(--pos-surface);
  position: sticky;
  top: 0;
  z-index: 2;
}

.toolbar__row {
  display: flex;
  gap: var(--pos-space-2);
  align-items: center;
  margin-bottom: var(--pos-space-2);
}

.barcode-input {
  max-width: 220px;
}

.cart-fab {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: var(--pos-primary-soft);
  color: var(--pos-primary);
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;

  &:hover {
    background: var(--pos-primary-hover);
  }

  &.has-items {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }
}

.cart-fab__count {
  position: absolute;
  top: -4px;
  inset-inline-start: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(var(--v-theme-error));
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.toolbar__chips {
  display: flex;
  gap: var(--pos-space-1);
  overflow-x: auto;
  padding: var(--pos-space-1) 0;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }
}

.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--pos-space-1);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--pos-surface-tint);
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
  user-select: none;

  &:hover {
    background: var(--pos-primary-soft);
  }

  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
  }
}

.chip__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 0 6px;
  height: 18px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;

  .chip.active & {
    background: rgba(255, 255, 255, 0.25);
    color: rgb(var(--v-theme-on-primary));
  }
}

/* ══════════════════ Product grid ══════════════════ */
.products__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--pos-space-2);
  padding: var(--pos-space-3);
  overflow-y: auto;
  align-content: start;
  min-height: 0;
  scrollbar-gutter: stable;
}

.products__empty {
  grid-column: 1 / -1;
  padding: 48px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.product {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--pos-space-1);
  padding: var(--pos-space-3);
  min-height: 104px;
  background: var(--pos-surface-soft);
  border: 1px solid var(--pos-border);
  border-radius: var(--pos-radius-md);
  cursor: pointer;
  text-align: right;
  font-family: inherit;
  color: inherit;
  transition: transform 0.08s ease, box-shadow 0.15s ease,
    border-color 0.15s ease, background 0.15s ease;
  /* Content-visibility: let the browser skip rendering offscreen cards. */
  content-visibility: auto;
  contain-intrinsic-size: 104px;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--pos-primary);
    background: var(--pos-primary-soft);
    box-shadow: 0 4px 14px rgba(var(--v-theme-primary), 0.14);
  }

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
    border-color: var(--pos-primary);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    background: var(--pos-primary-hover);
  }

  &--out,
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--skeleton {
    height: 104px;
    background: linear-gradient(
      90deg,
      var(--pos-surface-soft) 0%,
      var(--pos-surface-tint) 50%,
      var(--pos-surface-soft) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite ease-in-out;
    border: 1px solid var(--pos-border);
    pointer-events: none;
  }

  &--featured {
    background: linear-gradient(
      135deg,
      rgba(var(--v-theme-warning), 0.08),
      var(--pos-surface-soft) 70%
    );
    border-color: rgba(var(--v-theme-warning), 0.4);
    grid-column: span 2;
    min-height: 130px;
  }
}

@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.product__badge {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgb(var(--v-theme-warning));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.product__name {
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;

  .product--featured & {
    font-size: 1rem;
  }
}

.product__cat {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.product__foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.product__price {
  font-weight: 700;
  color: var(--pos-primary);
  font-variant-numeric: tabular-nums;
}

.product__stock {
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pos-surface-tint);

  &.stock-ok { color: rgb(var(--v-theme-success)); }
  &.stock-low { color: rgb(var(--v-theme-warning)); }
  &.stock-out { color: rgb(var(--v-theme-error)); }
}

/* ══════════════════ Cart ══════════════════ */
.cart__handle {
  display: none;
  padding: var(--pos-space-2) 0;
  justify-content: center;
  cursor: pointer;

  .is-mobile & {
    display: flex;
  }
}

.cart__handle-bar {
  width: 40px;
  height: 4px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.25);
}

.cart__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--pos-space-3) var(--pos-space-4);
  border-bottom: 1px solid var(--pos-border);
  flex-shrink: 0;
}

.cart__title-text {
  font-size: 1rem;
  font-weight: 700;
}

.cart__header-end {
  display: inline-flex;
  align-items: center;
  gap: var(--pos-space-2);
}

.cart__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--pos-primary-soft);
  color: var(--pos-primary);
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
}

.cart__clear-btn {
  opacity: 0.7;
}

.cart__customer {
  padding: var(--pos-space-2) var(--pos-space-4) var(--pos-space-2);
  border-bottom: 1px solid var(--pos-border);
  flex-shrink: 0;
}

.cart__lines {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.cart__empty {
  padding: 48px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cart__hints {
  display: flex;
  gap: var(--pos-space-3);
  flex-wrap: wrap;
  justify-content: center;
  margin-top: var(--pos-space-4);
}

.cart__hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.cart__hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 700;
  background: var(--pos-surface-tint);
  border: 1px solid var(--pos-border);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
}

/* ── Cart lines list ── */
.cart__lines-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* ── Line: 4-col compact row (info | stepper | subtotal | remove) ── */
.line {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: var(--pos-space-2);
  padding: var(--pos-space-2) var(--pos-space-3);
  position: relative;
  transition: background 0.15s ease;

  & + & {
    border-top: 1px solid var(--pos-border);
  }

  &:hover {
    background: var(--pos-surface-soft);
  }

  &--flash {
    animation: line-flash 0.9s ease-out;
  }
}

@keyframes line-flash {
  0%   { background: rgba(var(--v-theme-primary), 0.18); }
  60%  { background: rgba(var(--v-theme-primary), 0.08); }
  100% { background: transparent; }
}

/* List transitions */
.line-anim-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.line-anim-enter-to {
  opacity: 1;
  transform: translateY(0);
}
.line-anim-enter-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.line-anim-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  position: absolute;
  inset-inline: 0;
}
.line-anim-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
.line-anim-move {
  transition: transform 0.18s ease;
}

/* Name + breakdown column */
.line__info {
  min-width: 0;
  cursor: pointer;
  border-radius: var(--pos-radius-sm);

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 2px;
  }
}

.line__name {
  font-weight: 600;
  font-size: 0.88rem;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.line__breakdown {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.line__chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  border: none;
  font-family: inherit;

  &--warning {
    background: rgba(var(--v-theme-warning), 0.14);
    color: rgb(var(--v-theme-warning));
  }

  &--note {
    background: var(--pos-surface-tint);
    color: rgba(var(--v-theme-on-surface), 0.7);
    max-width: 100px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

/* Subtotal column */
.line__subtotal {
  font-weight: 700;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  min-width: 68px;
  text-align: end;
}

/* Remove button */
.line__remove {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.32);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: rgba(var(--v-theme-error), 0.1);
    color: rgb(var(--v-theme-error));
  }

  &:focus-visible {
    outline: 2px solid rgb(var(--v-theme-error));
    outline-offset: 1px;
  }
}

/* ── Qty stepper ── */
.qty {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--pos-surface);
  border: 1px solid var(--pos-border);
  padding: 2px;
}

.qty__btn {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    color: var(--pos-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }
}

.qty__input {
  width: 32px;
  text-align: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.85rem;

  &:focus-visible {
    outline: none;
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type='number'] {
    -moz-appearance: textfield;
  }
}

/* ══════════════════ Payment section ══════════════════ */

/* ── Method tabs: 4-column icon+label grid ── */
.pay__methods {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--pos-space-2);
  padding: var(--pos-space-2) var(--pos-space-3);
  border-top: 1px solid var(--pos-border);
  flex-shrink: 0;
}

.pay__paid {
  padding: 10px 12px 4px;
  border-top: 1px solid var(--pos-border);
  flex-shrink: 0;
}

.pay__paid-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--pos-space-2);
  margin-bottom: 8px;
}

.pay__paid-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pay__paid-label {
  font-weight: 800;
  font-size: 0.88rem;
}

.pay__paid-actions {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.pay__mini {
  border: 1px solid var(--pos-border);
  background: var(--pos-surface-soft);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    border-color: rgba(var(--v-theme-primary), 0.25);
  }
}

.pay__mini--adv {
  border-style: dashed;
}

.pay__mini-hint {
  margin-inline-start: 6px;
  opacity: 0.75;
  font-weight: 600;
}

.pay__paid-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--pos-space-2);
  align-items: center;
}

.pay__paid-input {
  min-width: 0;
}

.pay__delta {
  min-width: 140px;
  padding: 8px 10px;
  border-radius: var(--pos-radius-md);
  border: 1px solid var(--pos-border);
  background: var(--pos-surface-soft);
  text-align: end;
  font-variant-numeric: tabular-nums;

  &.is-success {
    border-color: rgba(var(--v-theme-success), 0.35);
    background: rgba(var(--v-theme-success), 0.08);
    color: rgb(var(--v-theme-success));
  }

  &.is-error {
    border-color: rgba(var(--v-theme-error), 0.35);
    background: rgba(var(--v-theme-error), 0.08);
    color: rgb(var(--v-theme-error));
  }
}

.pay__delta-value {
  font-weight: 900;
}

.pay__quick {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.pay__quick-btn {
  border: 1px solid var(--pos-border);
  background: var(--pos-surface-soft);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    border-color: rgba(var(--v-theme-primary), 0.25);
  }
}

.pay__refs {
  margin-top: 8px;
}

.pay__installment {
  margin-top: 8px;
}

.pay__installment-row {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.8);

  input {
    width: 16px;
    height: 16px;
  }
}

.pay__adjustments {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--pos-border);
}

.pay__adjust-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto;
  gap: 8px;
  align-items: center;
}

.pay__seg {
  display: inline-flex;
  border: 1px solid var(--pos-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--pos-surface-soft);
}

.pay__seg-btn {
  border: none;
  background: transparent;
  padding: 8px 10px;
  font-size: 0.72rem;
  font-weight: 900;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);

  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
  }
}

.pay__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
  white-space: nowrap;

  input {
    width: 16px;
    height: 16px;
  }
}

.pay__method {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: var(--pos-space-2) var(--pos-space-1);
  min-height: 60px;
  border-radius: var(--pos-radius-md);
  border: 1px solid var(--pos-border);
  background: var(--pos-surface-soft);
  color: inherit;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--pos-primary-soft);
    color: var(--pos-primary);
    border-color: rgba(var(--v-theme-primary), 0.25);
  }

  &.active {
    background: var(--pos-primary);
    color: rgb(var(--v-theme-on-primary));
    border-color: var(--pos-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }
}

/* ── Summary rows ── */
.pay__summary {
  padding: var(--pos-space-2) var(--pos-space-4) var(--pos-space-1);
  flex-shrink: 0;
}

.pay__summary-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: var(--pos-space-2);
  border-bottom: 1px solid var(--pos-border);
  margin-bottom: var(--pos-space-2);
}

.pay__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.pay__summary-label {
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.pay__summary-value {
  font-weight: 600;

  &--discount {
    color: rgb(var(--v-theme-warning));
  }
}

/* ── Total row ── */
.pay__total-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.pay__total-label {
  font-size: 1rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.pay__total-value {
  font-size: 1.6rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: var(--pos-primary);
  line-height: 1.2;
}

/* ── Blocking hint ── */
.pay__hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 0 var(--pos-space-4);
  flex-shrink: 0;
}

/* ── Actions ── */
.pay__actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--pos-space-2);
  padding: var(--pos-space-2) var(--pos-space-3) var(--pos-space-3);
  flex-shrink: 0;
}

.pay__draft-btn {
  height: 52px !important;
  font-size: 0.88rem;
  font-weight: 600;
}

.pay__checkout {
  height: 52px !important;
  font-size: 1rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.02em;
  position: relative;
}

.pay__hotkey {
  font-size: 0.68rem;
  opacity: 0.75;
  font-weight: 500;
  margin-inline-start: 4px;
}

/* ══════════════════ Line-edit dialog ══════════════════ */
.line-edit__title {
  padding-bottom: 0 !important;
}

.line-edit__name {
  font-size: 1rem;
  font-weight: 700;
}

.line-edit__body {
  display: flex;
  flex-direction: column;
  gap: var(--pos-space-3);
  padding-top: var(--pos-space-3) !important;
}

.line-edit__actions {
  padding: var(--pos-space-2) var(--pos-space-4) var(--pos-space-3);
}

/* ══════════════════ Overlays ══════════════════ */
.pos__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 15;
}

/* ══════════════════ Responsive ══════════════════ */
@media (max-width: 1280px) {
  .pos {
    grid-template-columns: minmax(0, 1fr) 380px;
  }

  .products__grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}

@media (max-width: 960px) {
  .pos {
    grid-template-columns: 1fr;
    height: auto;
    min-height: unset;
    gap: 0;
  }

  .pos__products {
    height: calc(100vh - 140px);
    min-height: 420px;
  }

  .products__grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    padding: 10px;
  }

  .product--featured {
    grid-column: span 2;
  }

  .barcode-input {
    max-width: 140px;
  }

  /* Cart becomes a bottom sheet */
  .pos__cart {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-height: 88vh;
    height: auto;
    border-radius: var(--pos-radius-lg) var(--pos-radius-lg) 0 0;
    transform: translateY(100%);
    transition: transform 0.25s ease;
    z-index: 20;
    box-shadow: 0 -10px 32px rgba(0, 0, 0, 0.25);

    &.is-open {
      transform: translateY(0);
    }
  }

  .cart__lines {
    max-height: 34vh;
  }

  .pay__methods {
    gap: 6px;
    padding: 8px 10px;
  }

  .pay__paid {
    padding: 8px 10px 4px;
  }

  .pay__paid-row {
    grid-template-columns: 1fr;
  }

  .pay__delta {
    min-width: 0;
    text-align: start;
  }

  .pay__adjust-grid {
    grid-template-columns: 1fr 1fr;
  }

  .pay__method {
    min-height: 52px;
    font-size: 0.68rem;
  }

  .pay__summary {
    padding: 8px 12px 4px;
  }

  .pay__total-value {
    font-size: 1.35rem;
  }

  .pay__actions {
    padding: 8px 10px 12px;
  }

  .pay__draft-btn,
  .pay__checkout {
    height: 48px !important;
    font-size: 0.92rem !important;
  }
}
</style>
