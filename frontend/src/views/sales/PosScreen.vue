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

      <header class="cart__header">
        <div class="cart__title">
          <v-icon size="22">mdi-cart-outline</v-icon>
          <span class="cart__title-text">السلة</span>
          <span v-if="itemCount > 0" class="cart__badge">{{ itemCount }}</span>
        </div>
        <v-btn
          v-if="items.length > 0"
          size="x-small"
          variant="text"
          color="error"
          @click="confirmClear"
        >
          تفريغ
        </v-btn>
      </header>

      <div class="cart__customer">
        <CustomerSelector v-model="customerId" :required="false" />
      </div>

      <div class="cart__lines" aria-live="polite">
        <div v-if="items.length === 0" class="cart__empty">
          <v-icon size="56" class="text-medium-emphasis">mdi-cart-outline</v-icon>
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
            v-for="(item, idx) in items"
            :key="item.id"
            class="line"
            :class="{ 'line--flash': flashItemId === item.id }"
          >
            <div class="line__main">
              <div class="line__name-row">
                <span class="line__index" aria-hidden="true">{{ idx + 1 }}</span>
                <span class="line__name" :title="item.name">{{ item.name }}</span>
              </div>
              <div class="line__chips">
                <span class="line__price">{{ formatMoney(item.price, currency) }}</span>
                <span v-if="item.discount > 0" class="line__chip line__chip--warning">
                  <v-icon size="11">mdi-tag-outline</v-icon>
                  − {{ formatMoney(item.discount, currency) }}
                </span>
                <button
                  v-if="item.note"
                  type="button"
                  class="line__chip line__chip--note"
                  :title="item.note"
                  @click="openLineEdit(item)"
                >
                  <v-icon size="11">mdi-note-text-outline</v-icon>
                  {{ truncate(item.note, 16) }}
                </button>
              </div>
            </div>

            <div class="line__qty-col">
              <div class="qty">
                <button
                  type="button"
                  class="qty__btn"
                  aria-label="إنقاص"
                  @click="decQty(item.id)"
                >
                  <v-icon size="18">mdi-minus</v-icon>
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
                <button
                  type="button"
                  class="qty__btn"
                  aria-label="زيادة"
                  @click="incQty(item.id)"
                >
                  <v-icon size="18">mdi-plus</v-icon>
                </button>
              </div>
              <span
                v-if="item.availableStock > 0 && item.qty >= item.availableStock"
                class="qty__max"
                :title="`الحد الأقصى: ${item.availableStock}`"
              >
                أقصى
              </span>
            </div>

            <div class="line__totals">
              <div class="line__subtotal">{{ formatMoney(lineSubtotal(item), currency) }}</div>
              <div
                v-if="item.qty > 1 || item.discount > 0"
                class="line__breakdown"
                aria-hidden="true"
              >
                {{ item.qty }}×{{ formatMoney(Math.max(0, item.price - item.discount), currency) }}
              </div>
            </div>

            <div class="line__actions">
              <button
                type="button"
                class="line__icon-btn"
                :aria-label="`خيارات ${item.name}`"
                @click="openLineEdit(item)"
              >
                <v-icon size="18">mdi-dots-horizontal</v-icon>
              </button>
              <button
                type="button"
                class="line__icon-btn line__icon-btn--danger"
                :aria-label="`إزالة ${item.name}`"
                @click="removeItem(item.id)"
              >
                <v-icon size="18">mdi-close</v-icon>
              </button>
            </div>
          </li>
        </TransitionGroup>
      </div>

      <!-- ── Payment bar ────────────────────────────────────── -->
      <section class="pay" aria-label="الدفع">
        <!-- Collapsible advanced options -->
        <div class="pay__advanced" :class="{ 'is-open': advOpen }">
          <button
            type="button"
            class="pay__advanced-toggle"
            :aria-expanded="advOpen"
            @click="advOpen = !advOpen"
          >
            <v-icon size="16">mdi-tune-variant</v-icon>
            <span>خيارات الدفع</span>
            <span v-if="adjSummary" class="pay__advanced-summary">{{ adjSummary }}</span>
            <v-icon size="16" class="pay__advanced-caret">
              {{ advOpen ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
            </v-icon>
          </button>

          <div v-show="advOpen" class="pay__advanced-body">
            <div class="pay__row">
              <span class="pay__row-label">الخصم</span>
              <v-btn-toggle
                v-model="saleDiscount.type"
                density="compact"
                variant="outlined"
                mandatory
                divided
              >
                <v-btn value="amount" size="x-small">مبلغ</v-btn>
                <v-btn value="percent" size="x-small">%</v-btn>
              </v-btn-toggle>
              <input
                :value="saleDiscount.value"
                type="number"
                min="0"
                class="pay__row-input"
                @change="(e) => (saleDiscount.value = Math.max(0, Number(e.target.value) || 0))"
              />
            </div>

            <div class="pay__row">
              <v-switch
                v-model="tax.enabled"
                density="compact"
                hide-details
                inset
                color="primary"
                label="ضريبة"
              />
              <input
                v-if="tax.enabled"
                :value="tax.value"
                type="number"
                min="0"
                max="100"
                class="pay__row-input"
                @change="(e) => (tax.value = Math.max(0, Number(e.target.value) || 0))"
              />
              <span v-if="tax.enabled" class="text-caption">%</span>
            </div>

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
                <v-icon size="16">{{ m.icon }}</v-icon>
                {{ m.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Compact breakdown: shown inline only when discount/tax in play -->
        <div
          v-if="items.length > 0 && (discountValue > 0 || taxValue > 0)"
          class="pay__breakdown"
        >
          <span class="pay__breakdown-item">
            <span class="text-medium-emphasis">فرعي</span>
            <span>{{ formatMoney(subtotal, currency) }}</span>
          </span>
          <span v-if="discountValue > 0" class="pay__breakdown-item text-warning">
            <span>خصم</span>
            <span>− {{ formatMoney(discountValue, currency) }}</span>
          </span>
          <span v-if="taxValue > 0" class="pay__breakdown-item">
            <span class="text-medium-emphasis">ضريبة</span>
            <span>+ {{ formatMoney(taxValue, currency) }}</span>
          </span>
        </div>

        <!-- Primary row: total / paid / change -->
        <div class="pay__primary pay__primary--list" role="list" aria-label="ملخص الدفع">
          <div class="pay__item pay__item--total" role="listitem">
            <span class="pay__item-label">الإجمالي</span>
            <span class="pay__item-value">{{ formatMoney(total, currency) }}</span>
          </div>

          <div class="pay__item pay__item--paid" role="listitem">
            <label for="pos-paid" class="pay__item-label">المستلم</label>
            <div class="paid">
              <input
                id="pos-paid"
                type="number"
                min="0"
                step="0.01"
                inputmode="numeric"
                class="paid__input"
                aria-label="المبلغ المستلم"
                placeholder="0"
                :value="payment.paidAmount"
                @input="(e) => setPaid(e.target.value)"
                @focus="(e) => e.target.select()"
              />
              <button
                type="button"
                class="paid__full"
                :disabled="total === 0"
                title="تعبئة المبلغ بالكامل"
                @click="applyExact"
              >
                كامل
              </button>
            </div>
          </div>

          <div class="pay__item pay__item--change" role="listitem">
            <span class="pay__item-label">{{ changeLabel }}</span>
            <span class="pay__item-value" :class="changeStateClass">
              {{ formatMoney(changeAmount, currency) }}
            </span>
          </div>
        </div>

        <!-- Quick amounts: appear when a total exists -->
        <div v-if="total > 0" class="pay__quicks" aria-label="مبالغ سريعة">
          <div class="pay__quicks-head">
            <span class="pay__quicks-title">مبالغ سريعة</span>
            <button
              v-if="payment.paidAmount > 0"
              type="button"
              class="quick quick--reset"
              title="تصفير المبلغ المستلم"
              @click="resetPaid"
            >
              تصفير
            </button>
          </div>
          <div class="pay__quicks-grid">
            <button
              v-for="amt in quickAmounts"
              :key="amt"
              type="button"
              class="quick quick--amt"
              @click="addToPaid(amt)"
            >
              +{{ formatMoney(amt, currency) }}
            </button>
          </div>
        </div>

        <!-- Installment switch (only when relevant) -->
        <v-switch
          v-if="authStore.isFeatureEnabled('installments') && remaining > 0"
          v-model="payment.saveAsInstallment"
          color="warning"
          density="compact"
          hide-details
          inset
          :label="
            customerId
              ? 'حفظ المتبقي كدَين (أقساط)'
              : 'اختر عميلاً لحفظ المتبقي كدَين'
          "
          :disabled="!customerId"
          class="pay__installment"
        />

        <!-- Blocking reason hint -->
        <div v-if="blockingReason" class="pay__hint">
          <v-icon size="16">mdi-information-outline</v-icon>
          {{ blockingReason }}
        </div>

        <!-- Actions -->
        <div class="pay__actions">
          <v-btn
            variant="text"
            size="small"
            :disabled="items.length === 0 || submitting"
            @click="onHold"
          >
            <v-icon start size="18">mdi-content-save-outline</v-icon>
            مسودة
          </v-btn>
          <v-btn
            size="x-large"
            color="primary"
            class="pay__checkout"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="checkout"
          >
            <v-icon start size="22">mdi-cash-register</v-icon>
            دفع وإتمام
            <span class="pay__hotkey">F9</span>
          </v-btn>
        </div>
      </section>
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
import { useAuthStore } from '@/stores/auth';
import { usePosCart } from '@/composables/usePosCart';
import CustomerSelector from '@/components/CustomerSelector.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

// ── Stores ──────────────────────────────────────────────────────────────────
const productStore = useProductStore();
const categoryStore = useCategoryStore();
const inventoryStore = useInventoryStore();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
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
const advOpen = ref(true);       // expanded on desktop, collapsed on mobile (set onMounted)
const clearDialog = ref(false);

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
  { value: 'cash', label: 'نقدي', icon: 'mdi-cash' },
  { value: 'card', label: 'بطاقة', icon: 'mdi-credit-card' },
  { value: 'bank_transfer', label: 'حوالة', icon: 'mdi-bank-transfer' },
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

/** Short summary of adjustments shown next to the "خيارات" toggle. */
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
  advOpen.value = !isMobile.value;

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
}

.cart__title {
  display: inline-flex;
  align-items: center;
  gap: var(--pos-space-2);
  font-weight: 700;
}

.cart__title-text {
  font-size: 0.95rem;
}

.cart__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--pos-primary);
  color: rgb(var(--v-theme-on-primary));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.cart__customer {
  padding: var(--pos-space-2) var(--pos-space-4) 0;
}

.cart__lines {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--pos-space-2) var(--pos-space-3) var(--pos-space-3);
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

/* ── Cart lines list (TransitionGroup target) ── */
.cart__lines-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* ── Line: indexed row with chips + breakdown ──
 * Divider-based rhythm (list), not stacked boxes — reads as one list.
 */
.line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: var(--pos-space-3);
  padding: var(--pos-space-2);
  border-radius: var(--pos-radius-md);
  position: relative;
  transition: background 0.15s ease;

  & + & {
    border-top: 1px solid var(--pos-border);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  &:hover {
    background: var(--pos-surface-soft);
  }

  /* Flash on add / qty-increase — quick primary pulse */
  &--flash {
    animation: line-flash 0.9s ease-out;
  }
}

@keyframes line-flash {
  0%   { background: rgba(var(--v-theme-primary), 0.22); }
  60%  { background: rgba(var(--v-theme-primary), 0.10); }
  100% { background: transparent; }
}

/* List enter/leave/move transitions */
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

/* ── Line inner layout ── */
.line__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.line__name-row {
  display: flex;
  align-items: baseline;
  gap: var(--pos-space-2);
  min-width: 0;
}

.line__index {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--pos-surface-tint);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.line__name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.line__chips {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pos-space-1);
  font-size: 0.72rem;
}

.line__price {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}

.line__chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--pos-surface-tint);
  color: rgba(var(--v-theme-on-surface), 0.75);
  border: none;
  font-family: inherit;
  max-width: 140px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  &--warning {
    background: rgba(var(--v-theme-warning), 0.14);
    color: rgb(var(--v-theme-warning));
  }

  &--note {
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;

    &:hover {
      background: var(--pos-primary-soft);
      color: var(--pos-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--pos-primary);
      outline-offset: 1px;
    }
  }
}

/* Qty cell with optional "أقصى" chip below the stepper */
.line__qty-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.qty__max {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
  line-height: 1.4;
  letter-spacing: 0.02em;
}

/* Totals cell: subtotal + tiny breakdown line */
.line__totals {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 74px;
  text-align: end;
}

.line__subtotal {
  font-weight: 700;
  color: var(--pos-primary);
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  line-height: 1.15;
}

.line__breakdown {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  margin-top: 1px;
}

/* Actions stack (⋯ and ×). Hover-reveal on pointer devices, always visible on touch. */
.line__actions {
  display: flex;
  gap: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .line__actions {
    opacity: 0.35;
    transition: opacity 0.15s ease;
  }

  .line:hover .line__actions,
  .line:focus-within .line__actions,
  .line--flash .line__actions {
    opacity: 1;
  }
}

.line__icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--pos-surface-tint);
    color: rgb(var(--v-theme-on-surface));
  }

  &--danger:hover {
    background: rgba(var(--v-theme-error), 0.12);
    color: rgb(var(--v-theme-error));
  }

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
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
  width: 28px;
  height: 28px;
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
  width: 38px;
  text-align: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.9rem;

  &:focus-visible {
    outline: none;
  }

  /* Hide number input spinners — we use the stepper buttons instead */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type='number'] {
    -moz-appearance: textfield;
  }
}

/* ══════════════════ Payment bar ══════════════════ */
.pay {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pos-space-2);
  padding: var(--pos-space-3) var(--pos-space-4) var(--pos-space-4);
  border-top: 1px solid var(--pos-border);
  background: var(--pos-surface);
}

/* ── Advanced options (collapsible) ── */
.pay__advanced {
  border-radius: var(--pos-radius-md);
  background: var(--pos-surface-soft);
  border: 1px solid var(--pos-border);
  overflow: hidden;
}

.pay__advanced-toggle {
  width: 100%;
  display: inline-flex;
  align-items: center;
  gap: var(--pos-space-2);
  padding: var(--pos-space-2) var(--pos-space-3);
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  text-align: inherit;

  &:hover {
    background: var(--pos-surface-tint);
  }
}

.pay__advanced-summary {
  flex: 1;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.78rem;
  margin-inline-start: var(--pos-space-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pay__advanced-caret {
  margin-inline-start: auto;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.pay__advanced-body {
  padding: var(--pos-space-2) var(--pos-space-3) var(--pos-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--pos-space-2);
  border-top: 1px solid var(--pos-border);
}

.pay__row {
  display: flex;
  align-items: center;
  gap: var(--pos-space-2);
  flex-wrap: wrap;
}

.pay__row-label {
  font-size: 0.82rem;
  font-weight: 500;
}

.pay__row-input {
  width: 100px;
  padding: 6px 8px;
  text-align: center;
  border: 1px solid var(--pos-border-strong);
  border-radius: var(--pos-radius-sm);
  background: var(--pos-surface);
  color: inherit;
  font-variant-numeric: tabular-nums;

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
    border-color: var(--pos-primary);
  }
}

.pay__methods {
  display: flex;
  gap: var(--pos-space-1);
  flex-wrap: wrap;
}

.pay__method {
  flex: 1 1 0;
  min-width: 90px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--pos-space-1);
  padding: 8px 10px;
  border-radius: var(--pos-radius-sm);
  border: 1px solid var(--pos-border);
  background: var(--pos-surface);
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover { background: var(--pos-primary-soft); }
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

/* ── Compact breakdown (inline) ── */
.pay__breakdown {
  display: flex;
  gap: var(--pos-space-3);
  flex-wrap: wrap;
  padding: 6px var(--pos-space-2);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.pay__breakdown-item {
  display: inline-flex;
  gap: 4px;
}

/* ── Primary row (Total / Paid / Change) ── */
.pay__primary {
  padding: var(--pos-space-2);
  background: var(--pos-surface-soft);
  border-radius: var(--pos-radius-md);
  border: 1px solid var(--pos-border);
}

.pay__primary--list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pay__item {
  display: grid;
  grid-template-columns: 92px 1fr;
  align-items: center;
  gap: var(--pos-space-2);
  padding: 10px var(--pos-space-2);
  border-radius: var(--pos-radius-sm);
  background: var(--pos-surface);
  border: 1px solid transparent;
}

.pay__item-label {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-weight: 700;
  white-space: nowrap;
}

.pay__item-value {
  font-size: 1.15rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: end;
}

.pay__item--total .pay__item-value {
  color: var(--pos-primary);
}

.pay__item--paid {
  border-color: rgba(var(--v-theme-primary), 0.16);
}

.pay__item--change .pay__item-value {
  &.is-success { color: rgb(var(--v-theme-success)); }
  &.is-error { color: rgb(var(--v-theme-error)); }
  &.is-neutral { color: rgba(var(--v-theme-on-surface), 0.6); }
}

/* ── Paid input group ── */
.paid {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.paid__input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--pos-border-strong);
  border-radius: var(--pos-radius-sm);
  background: var(--pos-surface);
  color: inherit;
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: end;
  direction: ltr;

  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
    border-color: var(--pos-primary);
  }

  &::placeholder {
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-weight: 600;
  }
}

.paid__full {
  padding: 0 12px;
  background: var(--pos-primary-soft);
  color: var(--pos-primary);
  border: 1px solid transparent;
  border-radius: var(--pos-radius-sm);
  font: inherit;
  font-weight: 700;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s ease;
  min-width: 56px;

  &:hover:not(:disabled) { background: var(--pos-primary-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

/* ── Quick amounts ── */
.pay__quicks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 var(--pos-space-2);
}

.pay__quicks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pos-space-2);
}

.pay__quicks-title {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.pay__quicks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 6px;
}

.quick {
  background: var(--pos-primary-soft);
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 5px 12px;
  color: var(--pos-primary);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 0.15s ease;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover { background: var(--pos-primary-hover); }
  &:focus-visible {
    outline: 2px solid var(--pos-primary);
    outline-offset: 1px;
  }

  &--reset {
    background: transparent;
    color: rgba(var(--v-theme-on-surface), 0.6);
    border-color: var(--pos-border);

    &:hover { background: var(--pos-surface-tint); }
  }

  &--amt {
    border-color: rgba(var(--v-theme-primary), 0.12);
  }
}

.pay__installment {
  margin: 0;
}

.pay__hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.pay__actions {
  display: flex;
  align-items: center;
  gap: var(--pos-space-2);
}

.pay__checkout {
  flex: 1;
  height: 56px;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  position: relative;
}

.pay__hotkey {
  position: absolute;
  inset-inline-start: 10px;
  top: 6px;
  font-size: 0.62rem;
  opacity: 0.7;
  font-weight: 500;
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
    max-height: 36vh;
  }

  /* Compact pay bar on mobile */
  .pay {
    padding: 10px 12px 12px;
    gap: 8px;
  }

  .pay__primary {
    padding: 8px;
  }

  .pay__item {
    grid-template-columns: 82px 1fr;
    padding: 8px 10px;
  }

  .pay__item-value {
    font-size: 1.05rem;
  }

  .pay__checkout {
    height: 52px;
    font-size: 1rem;
  }
}
</style>
