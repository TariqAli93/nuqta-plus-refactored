<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة المنتجات"
      subtitle="إدارة كتالوج المنتجات والمخزون والأسعار"
      icon="mdi-package-variant"
    >
      <v-btn
        v-if="canManageProducts"
        color="primary"
        prepend-icon="mdi-plus"
        size="default"
        to="/products/new"
        aria-label="إضافة منتج جديد"
      >
        منتج جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar pa-3">
      <div class="search-toolbar">
        <SearchBar
          :model-value="query"
          :loading="isSearching"
          placeholder="ابحث بالاسم، الرمز، الباركود، الوحدة..."
          aria-label="البحث عن منتج"
          @update:model-value="onQueryChange"
          @search="runNow"
          @clear="clear"
        />
      </div>

      <AdvancedFilters
        class="mt-3"
        :chips="filterChips"
        @clear="onClearFilters"
        @remove="onRemoveFilter"
      >
        <v-row dense>
          <v-col cols="12" sm="6" md="4">
            <v-select
              v-model="selectedCategory"
              :items="categories"
              item-title="name"
              item-value="id"
              label="التصنيف"
              clearable
              density="comfortable"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-shape-outline"
              @update:model-value="onCategoryChange"
            ></v-select>
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-select
              v-model="statusFilter"
              :items="statusOptions"
              item-title="title"
              item-value="value"
              label="الحالة"
              clearable
              density="comfortable"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-flag-outline"
              @update:model-value="onStatusChange"
            ></v-select>
          </v-col>
          <v-col cols="6" sm="3" md="2">
            <v-text-field
              v-model.number="minPrice"
              type="number"
              label="السعر من"
              density="comfortable"
              variant="outlined"
              hide-details
              min="0"
              @update:model-value="onPriceChange"
            ></v-text-field>
          </v-col>
          <v-col cols="6" sm="3" md="2">
            <v-text-field
              v-model.number="maxPrice"
              type="number"
              label="السعر إلى"
              density="comfortable"
              variant="outlined"
              hide-details
              min="0"
              @update:model-value="onPriceChange"
            ></v-text-field>
          </v-col>
        </v-row>
      </AdvancedFilters>
    </v-card>

    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة المنتجات
        </span>
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-download"
          :disabled="productStore.products.length === 0"
          aria-label="تصدير البيانات"
          @click="handleExport"
        >
          تصدير
        </v-btn>
      </div>
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="comfortable"
        class="mx-3 mt-3"
        closable
        @click:close="dismissError"
      >
        تعذر تنفيذ البحث حالياً، حاول مرة أخرى.
        <template #append>
          <v-btn size="small" variant="text" @click="refresh">إعادة المحاولة</v-btn>
        </template>
      </v-alert>

      <!-- Initial load shows a skeleton; subsequent searches keep the previous
           rows visible with a subtle top progress line (no layout jump). -->
      <TableSkeleton v-if="initialLoading" :rows="8" :columns="headers.length" class="pa-3" />
      <v-data-table
        v-else
        :headers="headers"
        :items="productStore.products"
        :loading="tableLoading"
        :items-per-page="productStore.pagination.limit"
        :page="productStore.pagination.page"
        :items-length="productStore.pagination.total"
        server-items-length
        density="comfortable"
        hide-default-footer
      >
        <template #no-data>
          <EmptyState
            v-if="hasActiveQuery"
            title="لا توجد نتائج مطابقة"
            description="حاول البحث بالاسم أو الرقم أو الباركود"
            icon="mdi-magnify-close"
            compact
          />
          <EmptyState
            v-else
            title="لا توجد منتجات"
            description="ابدأ بإضافة منتج جديد لبناء مخزونك"
            icon="mdi-package-variant"
            :actions="[
              {
                text: 'إضافة منتج جديد',
                icon: 'mdi-plus',
                to: '/products/new',
                color: 'primary',
              },
            ]"
            compact
          />
        </template>
        <template #[`item.name`]="{ item }">
          <div class="d-flex flex-column py-1">
            <span class="font-weight-medium">
              <template v-for="(seg, i) in highlightOf(item.name)" :key="i">
                <mark v-if="seg.match" class="search-hl">{{ seg.text }}</mark>
                <template v-else>{{ seg.text }}</template>
              </template>
            </span>
            <MatchBadge
              v-if="item.matchedField"
              :field="item.matchedField"
              :value="item.matchedValue"
              class="mt-1 align-self-start"
            />
          </div>
        </template>
        <template #[`item.sku`]="{ item }">
          <template v-for="(seg, i) in highlightOf(item.sku)" :key="i">
            <mark v-if="seg.match" class="search-hl">{{ seg.text }}</mark>
            <template v-else>{{ seg.text }}</template>
          </template>
        </template>
        <template #[`item.barcode`]="{ item }">
          <template v-for="(seg, i) in highlightOf(item.barcode)" :key="i">
            <mark v-if="seg.match" class="search-hl">{{ seg.text }}</mark>
            <template v-else>{{ seg.text }}</template>
          </template>
        </template>
        <template #[`item.stock`]="{ item }">
          <div class="flex items-center gap-1">
            <v-chip
              :color="isLowStock(item) ? 'error' : 'success'"
              size="small"
              :title="`المتوفر في المخزن المحدد: ${resolvedStock(item)}`"
            >
              {{ resolvedStock(item) }}
            </v-chip>
            <span v-if="item.totalStock != null" class="text-caption text-medium-emphasis">
              / {{ item.totalStock }} إجمالي
            </span>
          </div>
        </template>
        <template #[`item.sellingPrice`]="{ item }">
          {{ formatNumber(item.sellingPrice) }} {{ item.currency }}
        </template>
        <template #[`item.status`]="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small">
            {{ getStatusText(item.status) }}
          </v-chip>
        </template>
        <template #[`item.expiry`]="{ item }">
          <v-chip :color="item.tracksExpiry ? 'info' : 'grey'" size="small" variant="tonal">
            {{ item.tracksExpiry ? 'له تاريخ انتهاء' : 'بدون تاريخ انتهاء' }}
          </v-chip>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            :to="`/products/${item.id}/edit`"
            title="تعديل"
            aria-label="تعديل المنتج"
          >
            <v-icon size="20">mdi-pencil</v-icon>
          </v-btn>
          <v-btn
            v-if="canDeleteProducts"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="حذف"
            aria-label="حذف المنتج"
            @click="confirmDelete(item)"
          >
            <v-icon size="20">mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>

      <PaginationControls
        :pagination="productStore.pagination"
        @update:page="setPage"
        @update:items-per-page="setPageSize"
      />
    </v-card>

    <ConfirmDialog
      v-model="deleteDialog"
      title="تحذير: حذف نهائي"
      message="سيتم حذف المنتج نهائياً. سيتم الاحتفاظ باسم المنتج داخل الفواتير الملغية فقط، ولن تتأثر سجلات الأرشفة. إذا كان المنتج مستخدماً في بيانات فعالة (فواتير أو عمليات غير ملغية) فسيُرفض الحذف."
      :details="selectedProduct ? `المنتج: ${selectedProduct.name}` : ''"
      type="error"
      confirm-text="حذف نهائي"
      cancel-text="إلغاء"
      @confirm="handleDelete"
      @cancel="deleteDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useProductStore } from '@/stores/product';
import { useCategoryStore } from '@/stores/category';
import { useAuthStore } from '@/stores/auth';
import { useInventoryStore } from '@/stores/inventory';
import * as uiAccess from '@/auth/uiAccess.js';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PaginationControls from '@/components/PaginationControls.vue';
import PageHeader from '@/components/PageHeader.vue';
import SearchBar from '@/components/SearchBar.vue';
import AdvancedFilters from '@/components/AdvancedFilters.vue';
import MatchBadge from '@/components/MatchBadge.vue';
import { useServerSearch } from '@/composables/useServerSearch';
import { highlightSegments } from '@/utils/highlight';
import { useExport } from '@/composables/useExport';
import { useUndo } from '@/composables/useUndo';
import { useNotificationStore } from '@/stores/notification';

const productStore = useProductStore();
const categoryStore = useCategoryStore();
const authStore = useAuthStore();
const inventoryStore = useInventoryStore();

const userRole = computed(() => authStore.user?.role);
const canManageProducts = computed(() =>
  userRole.value ? uiAccess.canManageProducts(userRole.value) : false
);
const canDeleteProducts = computed(() =>
  userRole.value ? uiAccess.canManageProducts(userRole.value) : false
);

const categories = ref([]);
const deleteDialog = ref(false);
const selectedProduct = ref(null);

// Local refs backing the advanced-filter controls (kept in sync with the
// search composable's filter state).
const selectedCategory = ref(null);
const statusFilter = ref(null);
const minPrice = ref(null);
const maxPrice = ref(null);

const statusOptions = [
  { title: 'متاح', value: 'available' },
  { title: 'نفذ', value: 'out_of_stock' },
  { title: 'متوقف', value: 'discontinued' },
];

const currentWarehouseId = () => inventoryStore.selectedWarehouseId || undefined;

// Centralized debounced/cancelable/cached search. `warehouseId` is injected per
// request (not a user filter) so "مسح الفلاتر" never drops the warehouse
// context; warehouse changes bust the cache via refresh().
const { query, isSearching, error, onQueryChange, runNow, clear, setFilters, clearFilters, setPage, setPageSize, refresh } =
  useServerSearch({
    limit: productStore.pagination.limit,
    initialFilters: { categoryId: null, status: null, minPrice: null, maxPrice: null },
    load: (params, opts) =>
      productStore.fetch({ ...params, warehouseId: currentWarehouseId() }, { ...opts, silent: true }),
    apply: (res) => {
      productStore.products = res?.data || [];
      if (res?.meta) {
        productStore.pagination = {
          page: Number(res.meta.page) || 1,
          limit: Number(res.meta.limit) || productStore.pagination.limit,
          total: Number(res.meta.total) || 0,
          totalPages: Number(res.meta.totalPages) || 0,
        };
      }
    },
  });

const tableLoading = computed(() => isSearching.value || productStore.loading);
const initialLoading = computed(() => tableLoading.value && productStore.products.length === 0);
const hasActiveQuery = computed(() => !!query.value.trim() || filterChips.value.length > 0);

const filterChips = computed(() => {
  const chips = [];
  if (selectedCategory.value) {
    const cat = categories.value.find((c) => c.id === selectedCategory.value);
    chips.push({ key: 'categoryId', label: `التصنيف: ${cat?.name ?? selectedCategory.value}` });
  }
  if (statusFilter.value) {
    chips.push({ key: 'status', label: `الحالة: ${getStatusText(statusFilter.value)}` });
  }
  if (minPrice.value) chips.push({ key: 'minPrice', label: `السعر من: ${minPrice.value}` });
  if (maxPrice.value) chips.push({ key: 'maxPrice', label: `السعر إلى: ${maxPrice.value}` });
  return chips;
});

const highlightOf = (value) => highlightSegments(value, query.value);

const onCategoryChange = () => setFilters({ categoryId: selectedCategory.value || null });
const onStatusChange = () => setFilters({ status: statusFilter.value || null });
const onPriceChange = () =>
  setFilters({ minPrice: minPrice.value || null, maxPrice: maxPrice.value || null });

const onRemoveFilter = (key) => {
  if (key === 'categoryId') selectedCategory.value = null;
  if (key === 'status') statusFilter.value = null;
  if (key === 'minPrice') minPrice.value = null;
  if (key === 'maxPrice') maxPrice.value = null;
  setFilters({ [key]: null });
};

const onClearFilters = () => {
  selectedCategory.value = null;
  statusFilter.value = null;
  minPrice.value = null;
  maxPrice.value = null;
  clearFilters();
};

const dismissError = () => {
  error.value = null;
};

const headers = [
  { title: 'الاسم', key: 'name' },
  { title: 'رمز المنتج', key: 'sku' },
  { title: 'التصنيف', key: 'category' },
  { title: 'سعر البيع', key: 'sellingPrice' },
  { title: 'المخزون', key: 'stock' },
  { title: 'الحد الأدنى للمخزون', key: 'minStock' },
  { title: 'باركود', key: 'barcode' },
  { title: 'حالة الصلاحية', key: 'expiry' },
  { title: 'الحالة', key: 'status' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const getStatusColor = (status) => {
  const colors = {
    available: 'success',
    out_of_stock: 'warning',
    discontinued: 'error',
  };
  return colors[status] || 'grey';
};

const getStatusText = (status) => {
  const texts = {
    available: 'متاح',
    out_of_stock: 'نفذ',
    discontinued: 'متوقف',
  };

  return texts[status] || status;
};

// دالة تنسيق الأرقام مع الفواصل
const formatNumber = (value) => {
  const num = Number(value);
  return num.toLocaleString('ar-IQ', {
    style: 'currency',
    currency: 'IQD',
    numberingSystem: 'latn',
  });
};

const resolvedStock = (item) => {
  if (inventoryStore.selectedWarehouseId && item.warehouseStock != null) {
    return item.warehouseStock;
  }
  return item.totalStock != null ? item.totalStock : item.stock;
};

const isLowStock = (item) => {
  const qty = resolvedStock(item);
  const threshold =
    item.lowStockThreshold && item.lowStockThreshold > 0
      ? item.lowStockThreshold
      : item.minStock || 0;
  return qty <= threshold;
};

const confirmDelete = (product) => {
  selectedProduct.value = product;
  deleteDialog.value = true;
};

const { exportToCSV } = useExport();
const { registerUndo } = useUndo();
const notificationStore = useNotificationStore();

const handleExport = () => {
  try {
    const exportHeaders = headers.map((h) => ({
      title: h.title,
      key: h.key,
      value: (item) => {
        if (h.key === 'stock') return item.stock;
        if (h.key === 'sellingPrice') return `${item.sellingPrice} ${item.currency}`;
        if (h.key === 'status') return getStatusText(item.status);
        return item[h.key] || '';
      },
    }));
    exportToCSV(productStore.products, exportHeaders, 'products.csv');
    notificationStore.success('تم تصدير البيانات بنجاح');
  } catch {
    notificationStore.error('فشل تصدير البيانات');
  }
};

const handleDelete = async () => {
  const productId = selectedProduct.value.id;
  const productName = selectedProduct.value.name;

  try {
    await productStore.deleteProduct(productId);
    deleteDialog.value = false;
    // Bust the search cache so counts/pages reflect the deletion.
    refresh();

    // Register undo
    registerUndo(
      {
        undo: async () => {
          // Note: This would require a restore endpoint
          notificationStore.info('لا يمكن التراجع عن حذف المنتج');
        },
      },
      `تم حذف المنتج "${productName}"`
    );
  } catch (error) {
    // Error handled by notification
    notificationStore.error(error?.message || 'فشل حذف المنتج');
    console.error('Error deleting product:', error.message);
  }
};

onMounted(async () => {
  // Ensure inventory store has branches/warehouses so the per-warehouse column works
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  // Initial load goes through the search composable (default list).
  refresh();

  // Fetch all categories for the dropdown
  const { data } = await categoryStore.fetchCategories();
  categories.value = data || [];
});

// React to warehouse selection changes — bust the cache (results are
// warehouse-specific) and reload with the new warehouse context.
watch(
  () => inventoryStore.selectedWarehouseId,
  () => refresh()
);
</script>

<style scoped lang="scss">
.search-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.search-hl {
  background-color: rgba(var(--v-theme-warning), 0.38);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 700;
}
</style>
