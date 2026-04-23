<template>
  <div class="pos-screen" :class="{ 'cart-open': cartDrawerOpen }">
    <!-- ────────── Products pane ────────── -->
    <section class="pos-products">
      <header class="pos-products__header">
        <!-- Search + barcode + (mobile) cart toggle -->
        <div class="search-row">
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
          <v-btn
            v-if="isMobile"
            color="primary"
            size="large"
            class="cart-toggle"
            variant="tonal"
            @click="cartDrawerOpen = !cartDrawerOpen"
          >
            <v-icon start>{{ cartDrawerOpen ? 'mdi-close' : 'mdi-cart' }}</v-icon>
            <span class="font-weight-bold">{{ itemCount }}</span>
          </v-btn>
        </div>

        <!-- Category chips -->
        <div class="pos-chips" role="tablist" aria-label="التصنيفات">
          <button
            type="button"
            class="cat-chip"
            :class="{ active: selectedCategory === null }"
            role="tab"
            :aria-selected="selectedCategory === null"
            @click="selectedCategory = null"
          >
            الكل
            <span class="cat-chip__count">{{ products.length }}</span>
          </button>
          <button
            v-for="c in categoriesWithCounts"
            :key="c.id"
            type="button"
            class="cat-chip"
            :class="{ active: selectedCategory === c.id }"
            role="tab"
            :aria-selected="selectedCategory === c.id"
            @click="selectedCategory = c.id"
          >
            {{ c.name }}
            <span class="cat-chip__count">{{ c.count }}</span>
          </button>
        </div>
      </header>

      <!-- Product grid -->
      <div class="pos-products__grid" aria-live="polite">
        <template v-if="loadingProducts">
          <v-skeleton-loader
            v-for="n in 8"
            :key="`sk-${n}`"
            type="card"
            class="pos-product-skeleton"
          />
        </template>

        <template v-else-if="filteredProducts.length === 0">
          <div class="empty-state">
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
        </template>

        <template v-else>
          <button
            v-for="p in filteredProducts"
            :key="p.id"
            v-memo="[p.id, availableOf(p), p.sellingPrice, p.name]"
            class="pos-product-card"
            :class="{ 'is-out': availableOf(p) <= 0 }"
            :disabled="availableOf(p) <= 0"
            :title="p.name"
            @click="addProduct(p)"
          >
            <div class="pos-product-card__name">{{ p.name }}</div>
            <div v-if="p.category" class="pos-product-card__cat">{{ p.category }}</div>
            <div class="pos-product-card__bottom">
              <span class="pos-product-card__price">
                {{ formatMoney(p.sellingPrice, p.currency) }}
              </span>
              <span class="pos-product-card__stock" :class="stockClass(p)">
                {{ availableOf(p) }}
              </span>
            </div>
          </button>
        </template>
      </div>
    </section>

    <!-- ────────── Cart pane ────────── -->
    <aside class="pos-cart" :class="{ 'is-open': cartDrawerOpen }">
      <!-- Header: customer + compact actions -->
      <div class="pos-cart__top">
        <div class="flex items-center justify-space-between mb-2">
          <div class="flex items-center gap-1">
            <v-icon size="20">mdi-account</v-icon>
            <span class="text-subtitle-1 font-weight-bold">العميل</span>
            <span class="text-caption text-medium-emphasis ml-1">(اختياري)</span>
          </div>
          <v-btn
            v-if="customerId"
            size="x-small"
            variant="text"
            color="primary"
            @click="customerId = null"
          >
            إزالة
          </v-btn>
        </div>
        <CustomerSelector v-model="customerId" :required="false" />
      </div>

      <!-- Cart lines -->
      <div class="pos-cart__lines">
        <div v-if="items.length === 0" class="cart-empty">
          <v-icon size="56" class="text-medium-emphasis">mdi-cart-outline</v-icon>
          <div class="text-body-1 mt-2 font-weight-medium">السلة فارغة</div>
          <div class="text-caption text-medium-emphasis">
            اختر منتجاً أو امسح باركود لبدء البيع.
          </div>
        </div>

        <div
          v-for="item in items"
          :key="item.id"
          class="cart-line"
          :class="{ 'is-low': item.availableStock > 0 && item.qty >= item.availableStock }"
        >
          <div class="cart-line__head">
            <div class="cart-line__name">
              <div class="font-weight-medium text-truncate" :title="item.name">
                {{ item.name }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ formatMoney(item.price, currency) }}
                <span v-if="item.discount > 0" class="text-warning">
                  − {{ formatMoney(item.discount, currency) }}/وحدة
                </span>
              </div>
            </div>
            <v-btn
              icon
              density="comfortable"
              variant="text"
              size="small"
              :aria-label="`إزالة ${item.name}`"
              @click="removeItem(item.id)"
            >
              <v-icon size="18">mdi-close</v-icon>
            </v-btn>
          </div>

          <div class="cart-line__controls">
            <div class="qty-control">
              <v-btn
                density="comfortable"
                variant="tonal"
                size="small"
                icon
                aria-label="إنقاص"
                @click="decQty(item.id)"
              >
                <v-icon size="16">mdi-minus</v-icon>
              </v-btn>
              <input
                :value="item.qty"
                type="number"
                min="1"
                class="qty-input"
                inputmode="numeric"
                @blur="(e) => commitQty(item.id, e.target.value)"
                @keyup.enter="(e) => commitQty(item.id, e.target.value)"
              />
              <v-btn
                density="comfortable"
                variant="tonal"
                size="small"
                icon
                aria-label="زيادة"
                @click="incQty(item.id)"
              >
                <v-icon size="16">mdi-plus</v-icon>
              </v-btn>
            </div>
            <div class="cart-line__subtotal">
              {{ formatMoney(lineSubtotal(item), currency) }}
            </div>
          </div>

          <div v-if="expandedLineId === item.id" class="cart-line__extra">
            <v-text-field
              :model-value="item.discount"
              type="number"
              min="0"
              label="خصم / وحدة"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="(v) => updateLineDiscount(item.id, v)"
            />
            <v-text-field
              :model-value="item.note"
              label="ملاحظة"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="(v) => updateLineNote(item.id, v)"
            />
          </div>

          <button
            type="button"
            class="cart-line__toggle"
            @click="expandedLineId = expandedLineId === item.id ? null : item.id"
          >
            {{ expandedLineId === item.id ? 'إغلاق الخيارات' : 'خصم أو ملاحظة' }}
          </button>
        </div>
      </div>

      <!-- Footer: totals + payment -->
      <footer class="pos-cart__footer">
        <!-- Discount + optional tax -->
        <div class="footer-controls">
          <div class="inline-field">
            <span class="inline-label">الخصم</span>
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
              class="inline-input"
              @change="(e) => (saleDiscount.value = Math.max(0, Number(e.target.value) || 0))"
            />
          </div>

          <div class="inline-field">
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
              class="inline-input"
              @change="(e) => (tax.value = Math.max(0, Number(e.target.value) || 0))"
            />
            <span v-if="tax.enabled" class="text-caption">%</span>
          </div>
        </div>

        <!-- Summary rows -->
        <div class="totals">
          <div class="totals__row">
            <span>المجموع الفرعي</span>
            <span>{{ formatMoney(subtotal, currency) }}</span>
          </div>
          <div v-if="discountValue > 0" class="totals__row text-warning">
            <span>خصم</span>
            <span>− {{ formatMoney(discountValue, currency) }}</span>
          </div>
          <div v-if="taxValue > 0" class="totals__row">
            <span>ضريبة</span>
            <span>+ {{ formatMoney(taxValue, currency) }}</span>
          </div>
          <div class="totals__row totals__total">
            <span>الإجمالي</span>
            <span>{{ formatMoney(total, currency) }}</span>
          </div>
        </div>

        <!-- Payment method chips -->
        <div class="pay-methods">
          <button
            v-for="m in paymentMethods"
            :key="m.value"
            type="button"
            class="pay-method-chip"
            :class="{ active: payment.method === m.value }"
            @click="payment.method = m.value"
          >
            <v-icon size="16">{{ m.icon }}</v-icon>
            {{ m.label }}
          </button>
        </div>

        <!-- Paid amount + quick actions -->
        <div class="paid-row">
          <v-text-field
            :model-value="payment.paidAmount"
            type="number"
            min="0"
            variant="outlined"
            density="comfortable"
            hide-details
            label="المبلغ المستلم"
            @update:model-value="(v) => setPaid(v)"
          >
            <template #append-inner>
              <span class="text-caption text-medium-emphasis">{{ currency }}</span>
            </template>
          </v-text-field>
          <v-btn
            color="primary"
            variant="tonal"
            class="exact-btn"
            :disabled="total === 0"
            @click="applyExact"
          >
            كامل
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            :disabled="payment.paidAmount === 0"
            @click="resetPaid"
          >
            صفر
          </v-btn>
        </div>

        <div class="quick-amounts">
          <button
            v-for="amt in quickAmounts"
            :key="amt"
            type="button"
            class="quick-amount-chip"
            @click="addToPaid(amt)"
          >
            +{{ formatMoney(amt, currency) }}
          </button>
        </div>

        <div class="change-box">
          <div v-if="change > 0" class="change-row text-success">
            <span>الباقي للعميل</span>
            <span class="font-weight-bold">{{ formatMoney(change, currency) }}</span>
          </div>
          <div v-if="remaining > 0" class="change-row text-error">
            <span>المبلغ المتبقي</span>
            <span class="font-weight-bold">{{ formatMoney(remaining, currency) }}</span>
          </div>
        </div>

        <!-- Save as debt (installment) -->
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
        />

        <!-- Blocking reason hint -->
        <div v-if="blockingReason" class="blocking-hint">
          <v-icon size="16">mdi-information-outline</v-icon>
          {{ blockingReason }}
        </div>

        <!-- Actions -->
        <div class="actions">
          <v-btn
            variant="text"
            size="small"
            color="error"
            :disabled="items.length === 0"
            @click="confirmClear"
          >
            تفريغ
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            :disabled="items.length === 0 || submitting"
            @click="onHold"
          >
            حفظ كمسودة
          </v-btn>
          <v-btn
            size="large"
            color="primary"
            class="checkout-btn"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="checkout"
          >
            <v-icon start>mdi-cash-register</v-icon>
            دفع وإتمام
            <span class="hotkey-hint">F9</span>
          </v-btn>
        </div>
      </footer>
    </aside>

    <!-- Backdrop when cart drawer open on mobile -->
    <div
      v-if="isMobile && cartDrawerOpen"
      class="pos-backdrop"
      @click="cartDrawerOpen = false"
    />

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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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

// ── Cart composable (destructured for clean template access) ───────────────
const {
  currency,
  customerId,
  notes: _notes,
  items,
  saleDiscount,
  tax,
  payment,
  submitting,

  subtotal,
  discountValue,
  afterDiscount: _afterDiscount,
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
const expandedLineId = ref(null);
const cartDrawerOpen = ref(false);
const clearDialog = ref(false);

const searchRef = ref(null);
const barcodeRef = ref(null);

// Debounce the search text so rapid typing doesn't thrash the filter.
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
  currency.value === 'USD' ? [1, 5, 10, 20, 50, 100] : [1000, 5000, 10000, 25000, 50000, 100000]
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

/** Categories with their product counts — hides empty categories from view. */
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

// ── Formatting ─────────────────────────────────────────────────────────────
const formatMoney = (value, cur) => {
  const n = Number(value || 0);
  const c = cur || currency.value;
  return `${n.toLocaleString('en-US', {
    maximumFractionDigits: c === 'USD' ? 2 : 0,
  })} ${c}`;
};

// ── Product load ───────────────────────────────────────────────────────────
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

// Re-fetch when warehouse context changes; preserve filter/search
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

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
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
  // Avoid hijacking typing in text inputs for other keys.
  if (isEditable(e.target)) return;
};

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
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
});
</script>

<style scoped lang="scss">
/* ── Layout ─────────────────────────────────────────────────────────────── */
.pos-screen {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  gap: 16px;
  height: calc(100vh - 120px);
  min-height: 600px;
  direction: rtl;
}

.pos-products,
.pos-cart {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 16px;
  overflow: hidden;
}

/* ── Products pane ──────────────────────────────────────────────────────── */
.pos-products__header {
  padding: 12px 14px 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgb(var(--v-theme-surface));
  position: sticky;
  top: 0;
  z-index: 2;
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.barcode-input {
  max-width: 220px;
}

.cart-toggle {
  min-width: 92px;
}

.pos-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 0 6px;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }
}

.cat-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
  user-select: none;

  &:hover {
    background: rgba(var(--v-theme-primary), 0.08);
  }

  &.active {
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    border-color: rgb(var(--v-theme-primary));
  }
}

.cat-chip__count {
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

  .cat-chip.active & {
    background: rgba(255, 255, 255, 0.25);
    color: rgb(var(--v-theme-on-primary));
  }
}

.pos-products__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  align-content: start;
  min-height: 0;
  scrollbar-gutter: stable;
}

.pos-product-skeleton {
  border-radius: 12px;
}

.empty-state {
  grid-column: 1 / -1;
  padding: 48px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

/* ── Product tile ───────────────────────────────────────────────────────── */
.pos-product-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  min-height: 104px;
  background: rgba(var(--v-theme-surface-variant), 0.35);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 12px;
  cursor: pointer;
  text-align: right;
  font-family: inherit;
  color: inherit;
  transition: transform 0.08s ease, box-shadow 0.15s ease, border-color 0.15s ease,
    background 0.15s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgb(var(--v-theme-primary));
    background: rgba(var(--v-theme-primary), 0.06);
    box-shadow: 0 4px 16px rgba(var(--v-theme-primary), 0.14);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    background: rgba(var(--v-theme-primary), 0.1);
  }

  &.is-out,
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.pos-product-card__name {
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.pos-product-card__cat {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.pos-product-card__bottom {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pos-product-card__price {
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  font-variant-numeric: tabular-nums;
}

.pos-product-card__stock {
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);

  &.stock-ok {
    color: rgb(var(--v-theme-success));
  }

  &.stock-low {
    color: rgb(var(--v-theme-warning));
  }

  &.stock-out {
    color: rgb(var(--v-theme-error));
  }
}

/* ── Cart pane ──────────────────────────────────────────────────────────── */
.pos-cart__top {
  padding: 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.pos-cart__lines {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 12px;
  min-height: 0;
  scrollbar-gutter: stable;
}

.cart-empty {
  padding: 48px 16px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.cart-line {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &.is-low {
    outline: 1px solid rgba(var(--v-theme-warning), 0.5);
  }
}

.cart-line__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.cart-line__name {
  flex: 1;
  min-width: 0;
}

.cart-line__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.qty-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.qty-input {
  width: 56px;
  text-align: center;
  padding: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 600;

  &:focus-visible {
    outline: 2px solid rgb(var(--v-theme-primary));
    outline-offset: 1px;
  }
}

.cart-line__subtotal {
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  font-variant-numeric: tabular-nums;
}

.cart-line__extra {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cart-line__toggle {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* ── Footer (totals + payment) ─────────────────────────────────────────── */
.pos-cart__footer {
  padding: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface-variant), 0.2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.footer-controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.inline-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inline-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.inline-input {
  width: 90px;
  text-align: center;
  padding: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font-variant-numeric: tabular-nums;
}

.totals {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
}

.totals__row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  padding: 2px 0;
}

.totals__total {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  font-size: 1.35rem;
  font-weight: 800;
  color: rgb(var(--v-theme-primary));
}

.pay-methods {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pay-method-chip {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: rgba(var(--v-theme-primary), 0.06);
  }

  &.active {
    background: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    border-color: rgb(var(--v-theme-primary));
  }
}

.paid-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.exact-btn {
  height: 48px;
}

.quick-amounts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.quick-amount-chip {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 4px 10px;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(var(--v-theme-primary), 0.16);
  }
}

.change-box {
  min-height: 24px;
}

.change-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.95rem;
  padding: 2px 0;
}

.blocking-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.checkout-btn {
  flex: 1;
  height: 56px;
  font-size: 1.05rem;
  font-weight: 700;
  position: relative;
}

.hotkey-hint {
  position: absolute;
  left: 10px;
  top: 6px;
  font-size: 0.65rem;
  opacity: 0.75;
  font-weight: 500;
}

/* ── Mobile / tablet ────────────────────────────────────────────────────── */
@media (max-width: 1280px) {
  .pos-screen {
    grid-template-columns: minmax(0, 1fr) 400px;
  }
}

@media (max-width: 960px) {
  .pos-screen {
    grid-template-columns: 1fr;
    height: auto;
    min-height: unset;
  }

  .pos-products {
    height: calc(100vh - 140px);
    min-height: 420px;
  }

  .pos-cart {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(440px, 92vw);
    transform: translateX(100%);
    transition: transform 0.2s ease;
    z-index: 20;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);

    &.is-open {
      transform: translateX(0);
    }
  }

  .barcode-input {
    max-width: 160px;
  }
}

.pos-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 15;
}
</style>
