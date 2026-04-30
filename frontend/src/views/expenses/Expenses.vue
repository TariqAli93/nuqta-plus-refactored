<template>
  <v-container fluid class="expenses-page pa-3 pa-sm-4">
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة المصاريف</div>
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          size="default"
          aria-label="إضافة مصروف جديد"
          @click="openCreate"
        >
          مصروف جديد
        </v-btn>
      </div>
    </v-card>

    <!-- Summary cards -->
    <v-row v-if="summary" dense class="mb-4">
      <v-col cols="12" sm="6" md="3">
        <v-card class="mb-4">
          <v-card-text>
            <div class="text-caption">إجمالي المصاريف</div>
            <div class="text-h5 font-weight-bold">{{ moneyFmt(summary.total) }}</div>
            <div class="text-caption text-medium-emphasis">{{ summary.count || 0 }} عملية</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col
        v-for="row in summary.byCurrency || []"
        :key="`cur-${row.currency}`"
        cols="6"
        sm="3"
        md="3"
      >
        <v-card>
          <v-card-text>
            <div class="text-caption">{{ row.currency }}</div>
            <div class="text-h6">{{ moneyFmt(row.total) }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Filters -->
    <v-card class="mb-4">
      <v-card-text class="d-flex flex-wrap align-center gap-3">
        <v-text-field
          v-model="filters.dateFrom"
          type="date"
          label="من"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 180px"
        />
        <v-text-field
          v-model="filters.dateTo"
          type="date"
          label="إلى"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 180px"
        />
        <v-select
          v-model="filters.category"
          :items="categoryOptions"
          label="الفئة"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 200px"
        />
        <v-select
          v-if="isGlobalAdmin"
          v-model="filters.branchId"
          :items="branchOptions"
          item-title="name"
          item-value="id"
          label="الفرع"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 200px"
        />
        <v-btn variant="text" color="primary" @click="reload">تطبيق</v-btn>
        <v-btn variant="text" @click="clearFilters">مسح</v-btn>
      </v-card-text>
    </v-card>

    <!-- Table -->
    <v-card variant="outlined">
      <v-data-table
        :headers="headers"
        :items="items"
        :loading="loading"
        density="comfortable"
        items-per-page="25"
        class="expenses-table"
      >
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
            @click="openEdit(item)"
          />
          <v-btn
            v-if="canDelete"
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            @click="confirmDelete(item)"
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit dialog -->
    <v-dialog v-model="dialog" max-width="520">
      <v-card>
        <v-card-title>{{ editingId ? 'تعديل مصروف' : 'تسجيل مصروف جديد' }}</v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="save">
            <v-select
              v-model="formData.category"
              :items="categoryOptions"
              label="الفئة *"
              variant="outlined"
              :rules="[(v) => !!v || 'الفئة مطلوبة']"
              required
            />
            <v-text-field
              v-model.number="formData.amount"
              type="number"
              step="0.01"
              label="المبلغ *"
              variant="outlined"
              :rules="[
                (v) => !!v || 'المبلغ مطلوب',
                (v) => Number(v) > 0 || 'المبلغ يجب أن يكون أكبر من صفر',
              ]"
              required
            />
            <v-select
              v-model="formData.currency"
              :items="['USD', 'IQD']"
              label="العملة"
              variant="outlined"
            />
            <v-text-field
              v-model="formData.expenseDate"
              type="date"
              label="التاريخ"
              variant="outlined"
            />
            <v-select
              v-if="isGlobalAdmin"
              v-model="formData.branchId"
              :items="branchOptions"
              item-title="name"
              item-value="id"
              label="الفرع"
              variant="outlined"
              clearable
            />
            <v-textarea
              v-model="formData.note"
              label="ملاحظات"
              variant="outlined"
              rows="2"
              auto-grow
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useExpensesStore } from '@/stores/expenses';
import { useAuthStore } from '@/stores/auth';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';

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

<style scoped lang="scss">
.expenses-page {
  direction: rtl;
  max-width: 1400px;
  margin: 0 auto;
}
.gap-2 {
  gap: 0.5rem;
}
.gap-3 {
  gap: 0.75rem;
}
</style>
