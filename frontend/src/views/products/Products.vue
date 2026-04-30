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
      <v-row dense>
        <v-col cols="12" md="8">
          <v-text-field
            v-model="search"
            prepend-inner-icon="mdi-magnify"
            label="البحث بالاسم أو رمز المنتج أو الباركود"
            single-line
            hide-details
            density="comfortable"
            variant="outlined"
            clearable
            aria-label="البحث عن منتج"
            @input="handleSearch"
            @click:clear="handleSearch"
          ></v-text-field>
        </v-col>
        <v-col cols="12" md="4">
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
            @update:model-value="handleSearch"
          ></v-select>
        </v-col>
      </v-row>
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
      <v-data-table
        :headers="headers"
        :items="productStore.products"
        :loading="productStore.loading"
        :items-per-page="productStore.pagination.limit"
        :page="productStore.pagination.page"
        :items-length="productStore.pagination.total"
        server-items-length
        density="comfortable"
        hide-default-footer
        @update:items-per-page="changeItemsPerPage"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
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
        @update:page="changePage"
        @update:items-per-page="changeItemsPerPage"
      />
    </v-card>

    <ConfirmDialog
      v-model="deleteDialog"
      title="تأكيد الحذف"
      message="هل أنت متأكد من حذف المنتج؟"
      :details="selectedProduct ? `المنتج: ${selectedProduct.name}` : ''"
      type="error"
      confirm-text="حذف"
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

const search = ref('');
const selectedCategory = ref(null);
const categories = ref([]);
const deleteDialog = ref(false);
const selectedProduct = ref(null);

const headers = [
  { title: 'الاسم', key: 'name' },
  { title: 'رمز المنتج', key: 'sku' },
  { title: 'التصنيف', key: 'category' },
  { title: 'سعر البيع', key: 'sellingPrice' },
  { title: 'المخزون', key: 'stock' },
  { title: 'الحد الأدنى للمخزون', key: 'minStock' },
  { title: 'باركود', key: 'barcode' },
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

const currentWarehouseId = () => inventoryStore.selectedWarehouseId || undefined;

const handleSearch = () => {
  productStore.pagination.page = 1;
  productStore.fetch({
    search: search.value,
    categoryId: selectedCategory.value,
    warehouseId: currentWarehouseId(),
    page: 1,
    limit: productStore.pagination.limit,
  });
};

const changePage = (page) => {
  // Prevent recursive calls when API response updates pagination
  if (typeof window !== 'undefined' && window.isUpdatingFromAPI) {
    return;
  }

  // Initialize flag if not exists
  if (typeof window !== 'undefined' && window.isUpdatingFromAPI === undefined) {
    window.isUpdatingFromAPI = false;
  }

  const pageNum = Number(page);
  if (isNaN(pageNum) || pageNum < 1) {
    return;
  }
  if (pageNum === productStore.pagination.page) {
    return;
  }

  productStore.pagination.page = pageNum;
  productStore.fetch({
    search: search.value ?? '',
    categoryId: selectedCategory.value ?? null,
    warehouseId: currentWarehouseId(),
    page: pageNum,
    limit: productStore.pagination.limit,
  });
};

const changeItemsPerPage = (limit) => {
  const limitNum = Number(limit);
  productStore.pagination.limit = limitNum;
  productStore.pagination.page = 1;
  productStore.fetch({
    search: search.value,
    categoryId: selectedCategory.value,
    warehouseId: currentWarehouseId(),
    page: 1,
    limit: limitNum,
  });
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
  } catch {
    // Error handled by notification
  }
};

onMounted(async () => {
  // Ensure inventory store has branches/warehouses so the per-warehouse column works
  if (inventoryStore.branches.length === 0) await inventoryStore.fetchBranches();
  if (inventoryStore.warehouses.length === 0) await inventoryStore.fetchWarehouses();

  await productStore.fetch({
    page: 1,
    limit: productStore.pagination.limit,
    warehouseId: currentWarehouseId(),
  });

  // Fetch all categories for the dropdown
  const { data } = await categoryStore.fetchCategories();
  categories.value = data || [];
});

// React to warehouse selection changes
watch(
  () => inventoryStore.selectedWarehouseId,
  () => handleSearch()
);
</script>
