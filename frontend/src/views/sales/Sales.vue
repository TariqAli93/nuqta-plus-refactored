<template>
  <div>
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة المبيعات</div>
        <!-- Installment shortcut: hidden when the user lacks the capability
             entirely; rendered disabled with a tooltip when the feature flag
             is off so admins still see the entry point. -->
        <v-tooltip
          v-if="installmentsVisible"
          location="bottom"
          :text="installmentsReason"
          :disabled="!installmentsDisabled"
        >
          <template #activator="{ props: tipProps }">
            <span v-bind="tipProps">
              <v-btn
                color="primary"
                prepend-icon="mdi-plus"
                size="default"
                :to="installmentsDisabled ? undefined : '/sales/new'"
                :disabled="installmentsDisabled"
                aria-label="إنشاء بيع جديد"
              >
                قسط جديد
              </v-btn>
            </span>
          </template>
        </v-tooltip>
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
            :actions="emptyStateActions"
            compact
          />
        </template>
        <template #[`item.total`]="{ item }">
          <div>
            <div
              :class="
                Number(item.returnedTotal) > 0
                  ? 'text-decoration-line-through text-grey text-caption'
                  : ''
              "
            >
              {{ formatCurrency(item.total, item.currency) }}
            </div>
            <div
              v-if="Number(item.returnedTotal) > 0"
              class="text-success font-weight-bold"
            >
              {{
                formatCurrency(
                  Math.max(0, Number(item.total) - Number(item.returnedTotal)),
                  item.currency
                )
              }}
            </div>
          </div>
        </template>
        <template #[`item.status`]="{ item }">
          <v-chip
            v-if="getReturnState(item) === 'full'"
            color="warning"
            size="small"
            prepend-icon="mdi-keyboard-return"
            :title="`قيمة الإرجاع: ${formatCurrency(item.returnedTotal, item.currency)}`"
          >
            مُرجع كلياً
          </v-chip>
          <v-chip
            v-else-if="getReturnState(item) === 'partial'"
            color="warning"
            size="small"
            variant="tonal"
            prepend-icon="mdi-keyboard-return"
            :title="`قيمة الإرجاع: ${formatCurrency(item.returnedTotal, item.currency)}`"
          >
            مُرجع جزئياً
          </v-chip>
          <v-chip v-else :color="getStatusColor(item.status)" size="small">
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
            <v-tooltip
              v-if="draftsVisible"
              location="top"
              :text="draftsReason || 'إكمال المسودة'"
              :disabled="!draftsDisabled"
            >
              <template #activator="{ props: tipProps }">
                <span v-bind="tipProps">
                  <v-btn
                    size="small"
                    variant="text"
                    :color="draftsDisabled ? 'grey' : 'primary'"
                    icon
                    :disabled="draftsDisabled"
                    :title="draftsDisabled ? draftsReason : 'إكمال المسودة'"
                    @click.stop="completeDraft(item.id)"
                  >
                    <v-icon size="20">mdi-check</v-icon>
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
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
import { useFeatureGate } from '@/composables/useFeatureGate';
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

// Draft-related actions: visible when the user holds the capability; the
// button renders disabled with an explanation tooltip when the feature flag
// is off, so admins can see the entry point exists.
const draftsGate = useFeatureGate('draftInvoices', 'canUseDraftInvoices');
const canUseDrafts = computed(() => draftsGate.enabled.value);
const draftsVisible = draftsGate.visible;
const draftsDisabled = draftsGate.disabled;
const draftsReason = draftsGate.reason;

// Installment-sale shortcut: same disabled-with-tooltip pattern.
const installmentsGate = useFeatureGate('installments', 'canUseInstallments');
const canUseInstallments = computed(() => installmentsGate.enabled.value);
const installmentsVisible = installmentsGate.visible;
const installmentsDisabled = installmentsGate.disabled;
const installmentsReason = installmentsGate.reason;

// "New sale" empty-state action is the installment-sale entry point — only
// surface it when installments are enabled AND the user can use them.
const emptyStateActions = computed(() => {
  if (!canUseInstallments.value) return [];
  return [
    { text: 'بيع جديد', icon: 'mdi-plus', to: '/sales/new', color: 'primary' },
  ];
});

const deleteSaleDialog = ref(false);
const restoreSaleDialog = ref(false);
const selectedSaleForDelete = ref(null);
const selectedSaleForRestore = ref(null);

const { exportToCSV } = useExport();
const notificationStore = useNotificationStore();

// Drop the "draft" filter chip when draftInvoices is disabled — there are no
// draft sales to filter for, and showing the chip is misleading.
const statusOptions = computed(() => {
  const options = [
    { title: 'مكتمل', value: 'completed' },
    { title: 'قيد الانتظار', value: 'pending' },
    { title: 'ملغي', value: 'cancelled' },
  ];
  if (canUseDrafts.value) {
    options.push({ title: 'مسودة', value: 'draft' });
  }
  return options;
});

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

// Returns 'full' | 'partial' | 'none'. The list endpoint exposes
// `returnedTotal` (sum of all sale_returns.returnedValue), so a sale is fully
// returned when that aggregate covers the original total within the
// currency's rounding bucket.
const getReturnState = (item) => {
  const returned = Number(item.returnedTotal) || 0;
  if (returned <= 0) return 'none';
  const total = Number(item.total) || 0;
  const tolerance = item.currency === 'IQD' ? 250 : 0.01;
  return returned + tolerance >= total ? 'full' : 'partial';
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

const draftRouteFor = (sale) => {
  // Installment drafts open the full installment form; everything else
  // (cash/card/etc.) resumes in the quick-pay POS screen.
  const target = sale?.paymentType === 'installment' ? 'NewSale' : 'PosScreen';
  return { name: target, query: { draftId: sale.id } };
};

const viewSale = (_event, { item }) => {
  if (item.status === 'draft') {
    router.push(draftRouteFor(item));
  } else {
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
  const sale = saleStore.sales.find((s) => s.id === id);
  if (!sale) return;
  router.push(draftRouteFor(sale));
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
