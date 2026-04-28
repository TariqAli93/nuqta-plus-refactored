<template>
  <div>
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة العملاء</div>
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          size="default"
          to="/customers/new"
          aria-label="إضافة عميل جديد"
        >
          عميل جديد
        </v-btn>
      </div>
    </v-card>

    <v-card>
      <div class="pa-4 flex justify-lg-space-between items-center gap-4">
        <v-text-field
          v-model="search"
          prepend-inner-icon="mdi-magnify"
          label="البحث عن عميل"
          single-line
          hide-details
          density="comfortable"
          aria-label="البحث عن عميل"
          @input="handleSearch"
        ></v-text-field>
      </div>
    </v-card>

    <v-card class="mt-4">
      <v-card-title class="d-flex justify-space-between align-center">
        <span>قائمة العملاء</span>
        <v-btn
          icon="mdi-download"
          variant="text"
          size="small"
          :disabled="!customerStore.customers || customerStore.customers.length === 0"
          aria-label="تصدير البيانات"
          @click="handleExport"
        >
          <v-icon>mdi-download</v-icon>
        </v-btn>
      </v-card-title>
      <v-data-table
        :headers="headers"
        :items="customerStore.customers"
        :loading="customerStore.loading"
        :items-per-page="customerStore.pagination.limit"
        :page="customerStore.pagination.page"
        :items-length="customerStore.pagination.total"
        server-items-length
        hide-default-footer
        density="comfortable"
        @update:items-per-page="changeItemsPerPage"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
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
          <RouterLink :to="`/customers/${item.id}`" class="text-primary text-decoration-none">
            {{ item.name }}
          </RouterLink>
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
        @update:page="changePage"
        @update:items-per-page="changeItemsPerPage"
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
import { useExport } from '@/composables/useExport';
import { useUndo } from '@/composables/useUndo';
import { useNotificationStore } from '@/stores/notification';

const customerStore = useCustomerStore();
const authStore = useAuthStore();

const userRole = computed(() => authStore.user?.role);
const canDeleteCustomers = computed(() =>
  userRole.value ? uiAccess.canDeleteCustomers(userRole.value) : false
);

const search = ref('');
const deleteDialog = ref(false);
const selectedCustomer = ref(null);
const deleting = ref(false);

const headers = [
  { title: 'الاسم', key: 'name' },
  { title: 'الهاتف', key: 'phone' },
  { title: 'المدينة', key: 'city' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const handleSearch = () => {
  customerStore.pagination.page = 1;
  customerStore.fetch({
    search: search.value,
    page: 1,
    limit: customerStore.pagination.limit,
  });
};

const changePage = (page) => {
  const pageNum = Number(page);
  customerStore.pagination.page = pageNum;
  customerStore.fetch({
    search: search.value,
    page: pageNum,
    limit: customerStore.pagination.limit,
  });
};

const changeItemsPerPage = (limit) => {
  const limitNum = Number(limit);
  customerStore.pagination.limit = limitNum;
  customerStore.pagination.page = 1;
  customerStore.fetch({
    search: search.value,
    page: 1,
    limit: limitNum,
  });
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
  customerStore.fetch({
    page: 1,
    limit: customerStore.pagination.limit,
  });
});
</script>
