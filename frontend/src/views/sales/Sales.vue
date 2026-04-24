<template>
  <div>
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة المبيعات</div>
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          size="default"
          to="/sales/new"
          aria-label="إنشاء بيع جديد"
        >
          قسط جديد
        </v-btn>
      </div>
    </v-card>

    <v-card class="mb-4">
      <div class="flex justify-lg-space-between items-center pa-3 gap-4">
        <v-select
          v-model="filters.status"
          :items="statusOptions"
          label="الحالة"
          clearable
          hide-details
          density="comfortable"
          @update:model-value="handleFilter"
        ></v-select>

        <!-- العميل -->
        <v-autocomplete
          v-model="filters.customer"
          :items="customers"
          item-title="name"
          item-value="id"
          label="العميل"
          hide-details
          density="comfortable"
          clearable
          variant="outlined"
          :custom-filter="customFilter"
          @update:model-value="handleFilter"
        >
          <template #item="{ props, item }">
            <v-list-item v-bind="props">
              <template #title>
                {{ item.raw.name }}
              </template>
              <template #subtitle>
                {{ item.raw.phone }}
              </template>
            </v-list-item>
          </template>
          <template #selection="{ item }"> {{ item.raw.name }} - {{ item.raw.phone }} </template>
        </v-autocomplete>

        <v-text-field
          v-model="filters.startDate"
          label="من تاريخ"
          type="date"
          hide-details
          density="comfortable"
          @change="handleFilter"
        ></v-text-field>

        <v-text-field
          v-model="filters.endDate"
          label="إلى تاريخ"
          type="date"
          hide-details
          density="comfortable"
          @change="handleFilter"
        ></v-text-field>
      </div>
    </v-card>

    <v-card class="mb-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <span>قائمة المبيعات</span>
        <v-btn
          icon="mdi-download"
          variant="text"
          size="small"
          :disabled="saleStore.sales.length === 0"
          aria-label="تصدير البيانات"
          @click="handleExport"
        >
          <v-icon>mdi-download</v-icon>
        </v-btn>
      </v-card-title>
      <v-data-table
        :headers="headers"
        :items="saleStore.sales"
        :loading="saleStore.loading"
        :items-per-page="saleStore.pagination.limit"
        :page="saleStore.pagination.page"
        :items-length="saleStore.pagination.total"
        server-items-length
        hide-default-footer
        class="cursor-pointer"
        density="comfortable"
        @update:items-per-page="changeItemsPerPage"
        @click:row="viewSale"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد مبيعات"
            description="ابدأ بإنشاء بيع جديد"
            icon="mdi-cash-register"
            :actions="[
              {
                text: 'بيع جديد',
                icon: 'mdi-plus',
                to: '/sales/new',
                color: 'primary',
              },
            ]"
            compact
          />
        </template>
        <template #[`item.total`]="{ item }">
          {{ formatCurrency(item.total, item.currency) }}
        </template>
        <template #[`item.status`]="{ item }">
          <v-chip :color="getStatusColor(item.status)" size="small">
            {{ getStatusText(item.status) }}
          </v-chip>
        </template>
        <template #[`item.createdAt`]="{ item }">
          {{ toYmd(item.createdAt) }}
        </template>

        <template #[`item.paymentType`]="{ item }">
          {{ getPaymentTypeText(item.paymentType) }}
        </template>

        <template #[`item.actions`]="{ item }">
          <!-- أزرار المسودات -->
          <template v-if="item.status === 'draft'">
            <v-btn
              size="small"
              variant="text"
              color="primary"
              icon
              title="إكمال المسودة"
              @click.stop="completeDraft(item.id)"
            >
              <v-icon size="20">mdi-check</v-icon>
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              color="error"
              icon
              :disabled="!canDelete"
              title="حذف المسودة"
              @click.stop="deleteSale(item.id)"
            >
              <v-icon size="20">mdi-delete</v-icon>
            </v-btn>
          </template>
          <!-- أزرار المبيعات العادية -->
          <template v-else>
            <v-btn
              v-if="item.status !== 'cancelled'"
              size="small"
              variant="text"
              color="error"
              icon
              :disabled="!canDelete"
              title="إلغاء البيع"
              @click.stop="deleteSale(item.id)"
            >
              <v-icon size="20">mdi-delete</v-icon>
            </v-btn>
            <v-btn
              v-if="item.status === 'cancelled'"
              size="small"
              variant="text"
              color="success"
              icon
              :disabled="!canDelete"
              title="استعادة البيع"
              @click.stop="restoreSale(item.id)"
            >
              <v-icon size="20">mdi-restore</v-icon>
            </v-btn>
          </template>
        </template>
      </v-data-table>

      <PaginationControls
        :pagination="saleStore.pagination"
        @update:page="changePage"
        @update:items-per-page="changeItemsPerPage"
      />
    </v-card>

    <!-- Delete Sale Dialog -->
    <ConfirmDialog
      v-model="deleteSaleDialog"
      :title="selectedSaleForDelete?.status === 'draft' ? 'حذف المسودة' : 'إلغاء البيع'"
      :message="
        selectedSaleForDelete?.status === 'draft'
          ? 'هل أنت متأكد من حذف هذه المسودة؟'
          : 'هل أنت متأكد من رغبتك في إلغاء هذه المبيعات؟'
      "
      :details="selectedSaleForDelete ? `الفاتورة: ${selectedSaleForDelete.invoiceNumber}` : ''"
      type="error"
      confirm-text="نعم، تأكيد"
      cancel-text="إلغاء"
      @confirm="confirmDeleteSale"
      @cancel="deleteSaleDialog = false"
    />

    <!-- Restore Sale Dialog -->
    <ConfirmDialog
      v-model="restoreSaleDialog"
      title="استعادة البيع"
      message="هل أنت متأكد من رغبتك في استعادة هذه المبيعات؟"
      :details="selectedSaleForRestore ? `الفاتورة: ${selectedSaleForRestore.invoiceNumber}` : ''"
      type="info"
      confirm-text="نعم، استعادة"
      cancel-text="إلغاء"
      @confirm="confirmRestoreSale"
      @cancel="restoreSaleDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSaleStore } from '@/stores/sale';
import { useCustomerStore } from '@/stores/customer';
import { useAuthStore } from '../../stores/auth';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PaginationControls from '@/components/PaginationControls.vue';
import { useExport } from '@/composables/useExport';
import { useNotificationStore } from '@/stores/notification';

const router = useRouter();
const saleStore = useSaleStore();
const customerStore = useCustomerStore();
const authStore = useAuthStore();

const filters = ref({
  status: null,
  startDate: null,
  endDate: null,
  customer: '',
});

const customers = ref([]);
const isAdmin = computed(() => authStore.hasPermission(['sales:delete', 'manage:sales']));
const canDelete = computed(() => isAdmin.value);

const deleteSaleDialog = ref(false);
const restoreSaleDialog = ref(false);
const selectedSaleForDelete = ref(null);
const selectedSaleForRestore = ref(null);

const { exportToCSV } = useExport();
const notificationStore = useNotificationStore();

const statusOptions = [
  { title: 'مكتمل', value: 'completed' },
  { title: 'قيد الانتظار', value: 'pending' },
  { title: 'ملغي', value: 'cancelled' },
  { title: 'مسودة', value: 'draft' },
];

const headers = [
  { title: 'رقم الفاتورة', key: 'invoiceNumber' },
  { title: 'العميل', key: 'customer' },
  { title: 'رقم الهاتف', key: 'customerPhone' },
  { title: 'المبلغ الإجمالي', key: 'total' },
  { title: 'نوع الدفع', key: 'paymentType' },
  { title: 'الحالة', key: 'status' },
  { title: 'التاريخ', key: 'createdAt' },
  { title: 'بواسطة', key: 'createdBy', sortable: false },
  { title: 'الاجرائات', key: 'actions', sortable: false },
];

const formatCurrency = (amount, currency) => {
  const symbol = currency === 'USD' ? '$' : 'IQD';
  return `${symbol} ${parseFloat(amount).toLocaleString()}`;
};

const toYmd = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPaymentTypeText = (type) => {
  const types = { cash: 'نقدي', installment: 'تقسيط', mixed: 'مختلط' };
  return types[type] || type;
};

const getStatusColor = (status) => {
  const colors = {
    completed: 'success',
    pending: 'warning',
    cancelled: 'error',
    draft: 'info',
  };
  return colors[status] || 'grey';
};

const getStatusText = (status) => {
  const texts = {
    completed: 'مكتمل',
    pending: 'قيد الانتظار',
    cancelled: 'ملغي',
    draft: 'مسودة',
  };
  return texts[status] || status;
};

const handleFilter = () => {
  saleStore.pagination.page = 1;
  saleStore.fetch({
    ...filters.value,
    page: 1,
    limit: saleStore.pagination.limit,
  });
};

const changePage = (page) => {
  const pageNum = Number(page);
  saleStore.pagination.page = pageNum;
  saleStore.fetch({
    ...filters.value,
    page: pageNum,
    limit: saleStore.pagination.limit,
  });
};

const changeItemsPerPage = (limit) => {
  const limitNum = Number(limit);
  saleStore.pagination.limit = limitNum;
  saleStore.pagination.page = 1;
  saleStore.fetch({
    ...filters.value,
    page: 1,
    limit: limitNum,
  });
};

const viewSale = (_event, { item }) => {
  // إذا كانت المسودة، انتقل إلى صفحة إكمال البيع
  if (item.status === 'draft') {
    router.push({ name: 'NewSale', query: { draftId: item.id } });
  } else {
    // للمبيعات الأخرى، انتقل إلى صفحة التفاصيل
    router.push({ name: 'SaleDetails', params: { id: item.id } });
  }
};

const deleteSale = async (id) => {
  // التحقق من نوع العملية (مسودة أو بيع عادي)
  const sale = saleStore.sales.find((s) => s.id === id);

  selectedSaleForDelete.value = sale;
  deleteSaleDialog.value = true;
};

const confirmDeleteSale = async () => {
  const sale = selectedSaleForDelete.value;
  if (!sale) return;

  const isDraft = sale.status === 'draft';

  if (isDraft) {
    // حذف المسودة مباشرة
    try {
      await saleStore.removeSale(sale.id);
      handleFilter();
      deleteSaleDialog.value = false;
    } catch {
      // Error handled by store
    }
  } else {
    // إلغاء البيع العادي
    try {
      await saleStore.cancelSale(sale.id);
      handleFilter();
      deleteSaleDialog.value = false;
    } catch {
      // Error handled by store
    }
  }
};

const restoreSale = async (id) => {
  const sale = saleStore.sales.find((s) => s.id === id);
  selectedSaleForRestore.value = sale;
  restoreSaleDialog.value = true;
};

const confirmRestoreSale = async () => {
  const sale = selectedSaleForRestore.value;
  if (!sale) return;

  try {
    await saleStore.restoreSale(sale.id);
    handleFilter();
    restoreSaleDialog.value = false;
  } catch {
    // Error handled by store
  }
};

const completeDraft = async (id) => {
  // الانتقال إلى صفحة إكمال المسودة
  router.push({ name: 'NewSale', query: { draftId: id } });
};

const handleExport = () => {
  try {
    const exportHeaders = headers.map((h) => ({
      title: h.title,
      key: h.key,
      value: (item) => {
        if (h.key === 'total') return formatCurrency(item.total, item.currency);
        if (h.key === 'status') return getStatusText(item.status);
        if (h.key === 'paymentType') return getPaymentTypeText(item.paymentType);
        if (h.key === 'createdAt') return toYmd(item.createdAt);
        return item[h.key] || '';
      },
    }));
    exportToCSV(saleStore.sales, exportHeaders, 'sales.csv');
    notificationStore.success('تم تصدير البيانات بنجاح');
  } catch {
    notificationStore.error('فشل تصدير البيانات');
  }
};

// دالة البحث المخصصة: البحث بالاسم أو رقم الهاتف
const customFilter = (itemText, queryText, item) => {
  const query = queryText.toLowerCase();
  const name = item.raw.name?.toLowerCase() || '';
  const phone = item.raw.phone?.toLowerCase() || '';
  return name.includes(query) || phone.includes(query);
};

onMounted(async () => {
  await saleStore.fetch({
    page: 1,
    limit: saleStore.pagination.limit,
  });
  await customerStore.fetch();
  customers.value = customerStore.customers;
});
</script>
