<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة المصاريف"
      subtitle="تسجيل ومتابعة المصاريف التشغيلية"
      icon="mdi-cash-minus"
    >
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        size="default"
        aria-label="إضافة مصروف جديد"
        @click="openCreate"
      >
        مصروف جديد
      </v-btn>
    </PageHeader>

    <!-- Summary cards -->
    <div v-if="summary" class="summary-grid page-section">
      <StatCard
        label="إجمالي المصاريف"
        :value="moneyFmt(summary.total)"
        icon="mdi-sigma"
        icon-color="primary"
        :hint="`${summary.count || 0} عملية`"
      />
      <StatCard
        v-for="row in summary.byCurrency || []"
        :key="`cur-${row.currency}`"
        :label="row.currency"
        :value="moneyFmt(row.total)"
        icon="mdi-currency-usd"
        icon-color="success"
      />
    </div>

    <!-- Filters -->
    <v-card class="page-section filter-toolbar pa-3">
      <v-row dense>
        <v-col cols="12" sm="6" md="6">
          <v-text-field
            v-model="filters.dateFrom"
            type="date"
            label="من تاريخ"
            density="comfortable"
            variant="outlined"
            prepend-inner-icon="mdi-calendar-start"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="6" md="6">
          <v-text-field
            v-model="filters.dateTo"
            type="date"
            label="إلى تاريخ"
            density="comfortable"
            variant="outlined"
            prepend-inner-icon="mdi-calendar-end"
            hide-details
          />
        </v-col>
        <v-col cols="12" sm="6" md="6">
          <v-select
            v-model="filters.category"
            :items="categoryOptions"
            label="الفئة"
            density="comfortable"
            variant="outlined"
            prepend-inner-icon="mdi-tag-outline"
            hide-details
            clearable
          />
        </v-col>
        <v-col v-if="isGlobalAdmin" cols="12" sm="6" md="6">
          <v-select
            v-model="filters.branchId"
            :items="branchOptions"
            item-title="name"
            item-value="id"
            label="الفرع"
            density="comfortable"
            variant="outlined"
            prepend-inner-icon="mdi-source-branch"
            hide-details
            clearable
          />
        </v-col>

        <v-col cols="12">
          <v-btn variant="text" class="ml-2" @click="clearFilters">مسح</v-btn>
          <v-btn color="primary" prepend-icon="mdi-check" @click="reload">تطبيق</v-btn>
        </v-col>
      </v-row>
    </v-card>

    <!-- Table -->
    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة المصاريف
        </span>
      </div>
      <v-data-table
        :headers="headers"
        :items="items"
        :loading="loading"
        density="comfortable"
        items-per-page="25"
        class="expenses-table"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #[`item.amount`]="{ item }">
          <span class="font-weight-bold">{{ moneyFmt(item.amount) }} {{ item.currency }}</span>
        </template>
        <template #[`item.category`]="{ item }">
          <v-chip size="small" variant="tonal">{{ categoryLabel(item.category) }}</v-chip>
        </template>
        <template #[`item.expenseDate`]="{ item }">
          {{ item.expenseDate || '-' }}
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            v-if="canManage"
            icon="mdi-pencil"
            size="small"
            variant="text"
            title="تعديل"
            @click="openEdit(item)"
          />
          <v-btn
            v-if="canDelete"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="حذف"
            @click="confirmDelete(item)"
          />
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد مصاريف"
            description="ابدأ بتسجيل مصروف جديد لمتابعة المصاريف التشغيلية."
            icon="mdi-cash-minus"
            compact
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit dialog -->
    <v-dialog v-model="dialog" max-width="520">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>{{ editingId ? 'mdi-pencil' : 'mdi-cash-plus' }}</v-icon>
          <span>{{ editingId ? 'تعديل مصروف' : 'تسجيل مصروف جديد' }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-form ref="form" @submit.prevent="save">
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.category"
                  :items="categoryOptions"
                  label="الفئة *"
                  variant="outlined"
                  density="comfortable"
                  :rules="[(v) => !!v || 'الفئة مطلوبة']"
                  required
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.expenseDate"
                  type="date"
                  label="التاريخ"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col cols="12" sm="8">
                <v-text-field
                  v-model.number="formData.amount"
                  type="number"
                  step="0.01"
                  label="المبلغ *"
                  variant="outlined"
                  density="comfortable"
                  :rules="[
                    (v) => !!v || 'المبلغ مطلوب',
                    (v) => Number(v) > 0 || 'المبلغ يجب أن يكون أكبر من صفر',
                  ]"
                  required
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="formData.currency"
                  :items="['USD', 'IQD']"
                  label="العملة"
                  variant="outlined"
                  density="comfortable"
                />
              </v-col>
              <v-col v-if="isGlobalAdmin" cols="12">
                <v-select
                  v-model="formData.branchId"
                  :items="branchOptions"
                  item-title="name"
                  item-value="id"
                  label="الفرع"
                  variant="outlined"
                  density="comfortable"
                  clearable
                />
              </v-col>
              <v-col cols="12">
                <v-textarea
                  v-model="formData.note"
                  label="ملاحظات"
                  variant="outlined"
                  density="comfortable"
                  rows="2"
                  auto-grow
                />
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useExpensesStore } from '@/stores/expenses';
import { useAuthStore } from '@/stores/auth';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import StatCard from '@/components/StatCard.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

const expensesStore = useExpensesStore();
const authStore = useAuthStore();
const inventoryStore = useInventoryStore();
const notify = useNotificationStore();

const loading = computed(() => expensesStore.loading);
const items = computed(() => expensesStore.items);
const summary = computed(() => expensesStore.summary);
const isGlobalAdmin = computed(() => authStore.isGlobalAdmin);
const branchOptions = computed(() => inventoryStore.branches || []);
const canManage = computed(() => authStore.hasPermission?.(['expenses:update']));
const canDelete = computed(() => authStore.hasPermission?.(['expenses:delete']));

const CATEGORY_LABELS = {
  rent: 'إيجار',
  salary: 'رواتب',
  utilities: 'مرافق',
  supplies: 'مستلزمات',
  maintenance: 'صيانة',
  transport: 'نقل',
  marketing: 'تسويق',
  tax: 'ضرائب',
  other: 'أخرى',
};
const categoryOptions = Object.entries(CATEGORY_LABELS).map(([value, title]) => ({
  value,
  title,
}));
function categoryLabel(c) {
  return CATEGORY_LABELS[c] || c;
}

const filters = reactive({
  dateFrom: '',
  dateTo: '',
  category: null,
  branchId: null,
});

const headers = [
  { title: 'التاريخ', key: 'expenseDate', sortable: true },
  { title: 'الفئة', key: 'category' },
  { title: 'المبلغ', key: 'amount' },
  { title: 'الفرع', key: 'branchName' },
  { title: 'ملاحظات', key: 'note' },
  { title: 'بواسطة', key: 'createdByName' },
  { title: '', key: 'actions', sortable: false, align: 'end' },
];

const dialog = ref(false);
const saving = ref(false);
const editingId = ref(null);
const form = ref(null);
const formData = reactive({
  category: '',
  amount: null,
  currency: 'USD',
  expenseDate: new Date().toISOString().slice(0, 10),
  branchId: null,
  note: '',
});

function moneyFmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function reload() {
  const params = { ...filters };
  Object.keys(params).forEach((k) => {
    if (params[k] === null || params[k] === '' || params[k] === undefined) delete params[k];
  });
  await Promise.all([expensesStore.fetch(params), expensesStore.fetchSummary(params)]);
}

function clearFilters() {
  filters.dateFrom = '';
  filters.dateTo = '';
  filters.category = null;
  filters.branchId = null;
  reload();
}

function resetForm() {
  formData.category = '';
  formData.amount = null;
  formData.currency = 'USD';
  formData.expenseDate = new Date().toISOString().slice(0, 10);
  formData.branchId = null;
  formData.note = '';
  editingId.value = null;
}

function openCreate() {
  resetForm();
  dialog.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  formData.category = row.category;
  formData.amount = row.amount;
  formData.currency = row.currency;
  formData.expenseDate = row.expenseDate || '';
  formData.branchId = row.branchId || null;
  formData.note = row.note || '';
  dialog.value = true;
}

async function save() {
  const { valid } = await form.value.validate();
  if (!valid) return;
  saving.value = true;
  try {
    if (editingId.value) {
      await expensesStore.update(editingId.value, { ...formData });
    } else {
      await expensesStore.create({ ...formData });
    }
    dialog.value = false;
    await reload();
  } catch (err) {
    // axios interceptor surfaces the toast — keep dialog open for fixes.
    console.error('Failed to save expense', err);
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(row) {
  if (!window.confirm(`حذف المصروف بقيمة ${moneyFmt(row.amount)} ${row.currency}؟`)) return;
  try {
    await expensesStore.remove(row.id);
    await reload();
  } catch {
    notify.error('فشل حذف المصروف');
  }
}

onMounted(async () => {
  if (isGlobalAdmin.value) {
    try {
      await inventoryStore.fetchBranches();
    } catch {
      /* ignore */
    }
  }
  await reload();
});
</script>
