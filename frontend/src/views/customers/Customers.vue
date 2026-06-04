<template>
  <div class="page-shell">
    <PageHeader title="إدارة العملاء" subtitle="عرض وإدارة بيانات عملائك" icon="mdi-account-group">
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        size="default"
        to="/customers/new"
        aria-label="إضافة عميل جديد"
      >
        عميل جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar pa-3">
      <div class="search-toolbar">
        <SearchBar
          :model-value="query"
          :loading="isSearching"
          placeholder="ابحث بالاسم، الهاتف، العنوان، الملاحظات..."
          aria-label="البحث عن عميل"
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
            <v-text-field
              v-model="cityFilter"
              label="المدينة"
              clearable
              density="comfortable"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-city-variant-outline"
              @update:model-value="onCityChange"
            ></v-text-field>
          </v-col>
          <v-col cols="12" sm="6" md="4" class="d-flex align-center">
            <v-switch
              v-model="hasDebtFilter"
              label="عليه دين فقط"
              color="primary"
              density="comfortable"
              hide-details
              @update:model-value="onHasDebtChange"
            ></v-switch>
          </v-col>
        </v-row>
      </AdvancedFilters>
    </v-card>

    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة العملاء
        </span>
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-download"
          :disabled="!customerStore.customers || customerStore.customers.length === 0"
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

      <TableSkeleton v-if="initialLoading" :rows="8" :columns="headers.length" class="pa-3" />
      <v-data-table
        v-else
        :headers="headers"
        :items="customerStore.customers"
        :loading="tableLoading"
        :items-per-page="customerStore.pagination.limit"
        :page="customerStore.pagination.page"
        :items-length="customerStore.pagination.total"
        server-items-length
        hide-default-footer
        density="comfortable"
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
            title="لا يوجد عملاء"
            description="ابدأ بإضافة عميل جديد"
            icon="mdi-account-group"
            :actions="[
              {
                text: 'إضافة عميل جديد',
                icon: 'mdi-plus',
                to: '/customers/new',
                color: 'primary',
              },
            ]"
            compact
          />
        </template>
        <template #[`item.name`]="{ item }">
          <div class="d-flex flex-column py-1">
            <RouterLink :to="`/customers/${item.id}`" class="text-primary text-decoration-none">
              <template v-for="(seg, i) in highlightOf(item.name)" :key="i">
                <mark v-if="seg.match" class="search-hl">{{ seg.text }}</mark>
                <template v-else>{{ seg.text }}</template>
              </template>
            </RouterLink>
            <MatchBadge
              v-if="item.matchedField"
              :field="item.matchedField"
              :value="item.matchedValue"
              class="mt-1 align-self-start"
            />
          </div>
        </template>
        <template #[`item.phone`]="{ item }">
          <template v-for="(seg, i) in highlightOf(item.phone)" :key="i">
            <mark v-if="seg.match" class="search-hl">{{ seg.text }}</mark>
            <template v-else>{{ seg.text }}</template>
          </template>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-account-details"
            size="small"
            variant="text"
            :to="`/customers/${item.id}`"
            title="عرض الملف"
            aria-label="عرض ملف العميل"
          >
            <v-icon size="20">mdi-account-details</v-icon>
          </v-btn>
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            :to="`/customers/${item.id}/edit`"
            title="تعديل"
            aria-label="تعديل العميل"
          >
            <v-icon size="20">mdi-pencil</v-icon>
          </v-btn>
          <v-btn
            v-if="canDeleteCustomers"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="حذف"
            aria-label="حذف العميل"
            @click="confirmDelete(item)"
          >
            <v-icon size="20">mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>

      <PaginationControls
        :pagination="customerStore.pagination"
        @update:page="setPage"
        @update:items-per-page="setPageSize"
      />
    </v-card>

    <ConfirmDialog
      v-model="deleteDialog"
      title="تأكيد الحذف"
      message="هل أنت متأكد من حذف العميل؟"
      :details="selectedCustomer ? `العميل: ${selectedCustomer.name}` : ''"
      type="error"
      confirm-text="حذف"
      cancel-text="إلغاء"
      :loading="deleting"
      @confirm="handleDelete"
      @cancel="deleteDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useCustomerStore } from '@/stores/customer';
import { useAuthStore } from '@/stores/auth';
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

const customerStore = useCustomerStore();
const authStore = useAuthStore();

const userRole = computed(() => authStore.user?.role);
const canDeleteCustomers = computed(() =>
  userRole.value ? uiAccess.canDeleteCustomers(userRole.value) : false
);

const deleteDialog = ref(false);
const selectedCustomer = ref(null);
const deleting = ref(false);

const cityFilter = ref(null);
const hasDebtFilter = ref(false);

const headers = [
  { title: 'الاسم', key: 'name' },
  { title: 'الهاتف', key: 'phone' },
  { title: 'المدينة', key: 'city' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const { query, isSearching, error, onQueryChange, runNow, clear, setFilters, clearFilters, setPage, setPageSize, refresh } =
  useServerSearch({
    limit: customerStore.pagination.limit,
    initialFilters: { city: null, hasDebt: null },
    load: (params, opts) => customerStore.fetch(params, { ...opts, silent: true }),
    apply: (res) => {
      customerStore.customers = res?.data || [];
      if (res?.meta) {
        customerStore.pagination = {
          page: Number(res.meta.page) || 1,
          limit: Number(res.meta.limit) || customerStore.pagination.limit,
          total: Number(res.meta.total) || 0,
          totalPages: Number(res.meta.totalPages) || 0,
        };
      }
    },
  });

const tableLoading = computed(() => isSearching.value || customerStore.loading);
const initialLoading = computed(
  () => tableLoading.value && (customerStore.customers?.length || 0) === 0
);

const filterChips = computed(() => {
  const chips = [];
  if (cityFilter.value) chips.push({ key: 'city', label: `المدينة: ${cityFilter.value}` });
  if (hasDebtFilter.value) chips.push({ key: 'hasDebt', label: 'عليه دين' });
  return chips;
});

const hasActiveQuery = computed(() => !!query.value.trim() || filterChips.value.length > 0);

const highlightOf = (value) => highlightSegments(value, query.value);

const onCityChange = () => setFilters({ city: cityFilter.value || null });
const onHasDebtChange = () => setFilters({ hasDebt: hasDebtFilter.value ? true : null });

const onRemoveFilter = (key) => {
  if (key === 'city') cityFilter.value = null;
  if (key === 'hasDebt') hasDebtFilter.value = false;
  setFilters({ [key]: null });
};

const onClearFilters = () => {
  cityFilter.value = null;
  hasDebtFilter.value = false;
  clearFilters();
};

const dismissError = () => {
  error.value = null;
};

const confirmDelete = (customer) => {
  selectedCustomer.value = customer;
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
    }));
    exportToCSV(customerStore.customers, exportHeaders, 'customers.csv');
    notificationStore.success('تم تصدير البيانات بنجاح');
  } catch {
    notificationStore.error('فشل تصدير البيانات');
  }
};

const handleDelete = async () => {
  deleting.value = true;
  const customerId = selectedCustomer.value.id;
  const customerName = selectedCustomer.value.name;

  try {
    await customerStore.deleteCustomer(customerId);
    deleteDialog.value = false;
    refresh();

    // Register undo
    registerUndo(
      {
        undo: async () => {
          notificationStore.info('لا يمكن التراجع عن حذف العميل');
        },
      },
      `تم حذف العميل "${customerName}"`
    );
  } catch {
    // Error handled by notification
  } finally {
    deleting.value = false;
  }
};

onMounted(() => {
  refresh();
});
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
