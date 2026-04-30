<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة المستخدمين"
      subtitle="إدارة حسابات الموظفين، الصلاحيات والفروع المعيّنة"
      icon="mdi-account-multiple"
    >
      <v-btn color="primary" prepend-icon="mdi-plus" size="default" @click="openForm()">
        مستخدم جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar pa-3">
      <v-row dense>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="store.filters.search"
            label="بحث بالاسم"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="comfortable"
            hide-details
            clearable
            @keyup.enter="store.fetch()"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="store.filters.role"
            :items="roleOptions"
            label="الدور"
            item-title="title"
            item-value="value"
            variant="outlined"
            density="comfortable"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="store.filters.isActive"
            :items="statusOptions"
            label="الحالة"
            variant="outlined"
            density="comfortable"
            hide-details
            clearable
          />
        </v-col>

        <v-col cols="12" md="3" class="d-flex align-center justify-end">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-refresh" @click="store.fetch()">
            تحديث
          </v-btn>
        </v-col>
      </v-row>
    </v-card>

    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة المستخدمين
        </span>
      </div>
      <v-data-table
        :items="store.list"
        :loading="store.loading"
        :headers="headers"
        :items-per-page="store.limit"
        density="comfortable"
        hide-default-footer
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
            title="لا يوجد مستخدمون"
            description="ابدأ بإضافة مستخدم جديد"
            icon="mdi-account-multiple-outline"
            compact
          />
        </template>
        <template #[`item.role`]="{ item }">
          <v-chip color="primary" variant="tonal" size="small">
            {{ getRoleName(item.role) }}
          </v-chip>
        </template>
        <template #[`item.isActive`]="{ item }">
          <v-chip :color="item.isActive ? 'success' : 'grey'" variant="tonal" size="small">
            {{ item.isActive ? 'نشط' : 'معطل' }}
          </v-chip>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            color="primary"
            title="تعديل"
            @click="openForm(item)"
          >
            <v-icon size="20">mdi-pencil</v-icon>
          </v-btn>
          <v-btn
            icon="mdi-lock-reset"
            size="small"
            variant="text"
            color="warning"
            title="تغيير كلمة المرور"
            @click="openResetPwDialog(item)"
          >
            <v-icon size="20">mdi-lock-reset</v-icon>
          </v-btn>
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="حذف"
            @click="remove(item)"
          >
            <v-icon size="20">mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/edit user dialog -->
    <v-dialog v-model="showForm" max-width="600">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>{{ form.id ? 'mdi-pencil' : 'mdi-account-plus' }}</v-icon>
          <span>{{ form.id ? 'تعديل مستخدم' : 'مستخدم جديد' }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-form ref="formRef" @submit.prevent="save">
            <v-row dense>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.username"
                  label="اسم المستخدم"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-account"
                  :disabled="!!form.id"
                  required
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.fullName"
                  label="الاسم الكامل"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-card-account-details-outline"
                  required
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.phone"
                  label="الهاتف"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-phone"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="form.role"
                  :items="roleOptions"
                  item-title="title"
                  item-value="value"
                  label="الدور"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-shield-account"
                  required
                />
              </v-col>
              <v-col v-if="!isGlobalRole(form.role)" cols="12" md="6">
                <v-select
                  v-model="form.assignedBranchId"
                  :items="inventoryStore.branches"
                  item-title="name"
                  item-value="id"
                  label="الفرع المعيّن"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-source-branch"
                  :rules="[rules.required]"
                  @update:model-value="onBranchChange"
                />
              </v-col>
              <v-col v-if="!isGlobalRole(form.role) && form.assignedBranchId" cols="12" md="6">
                <v-select
                  v-model="form.assignedWarehouseId"
                  :items="warehousesForForm"
                  item-title="name"
                  item-value="id"
                  label="المخزن المعيّن (اختياري)"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-warehouse"
                  clearable
                />
              </v-col>
              <v-col v-if="!form.id" cols="12" md="6">
                <v-text-field
                  v-model="form.password"
                  label="كلمة المرور"
                  type="password"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="mdi-lock"
                  required
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-switch
                  v-model="form.isActive"
                  color="primary"
                  density="comfortable"
                  hide-details
                  inset
                  :label="form.isActive ? 'نشط' : 'معطل'"
                />
              </v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showForm = false">إلغاء</v-btn>
          <v-btn color="primary" prepend-icon="mdi-content-save" @click="save"> حفظ </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reset password dialog -->
    <v-dialog v-model="resetPwDialog" max-width="520">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>mdi-lock-reset</v-icon>
          <span>تغيير كلمة المرور</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-form ref="resetPwRef" lazy-validation @submit.prevent="resetPw">
            <v-text-field
              v-model="resetPwInfo.newPassword"
              label="كلمة المرور الجديدة"
              type="password"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-lock"
              :rules="[rules.required, rules.minLength]"
              class="mb-2"
            />
            <v-text-field
              v-model="resetPwInfo.confirmPassword"
              label="تأكيد كلمة المرور"
              type="password"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-lock-check"
              :rules="[
                rules.required,
                rules.confirmPassword(resetPwInfo.newPassword),
                rules.minLength,
              ]"
            />
          </v-form>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeResetPwDialog">إلغاء</v-btn>
          <v-btn color="primary" prepend-icon="mdi-check" @click="resetPw">
            تغيير كلمة المرور
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="deleteDialog"
      title="حذف المستخدم"
      :message="`هل أنت متأكد من حذف ${selectedItem?.username}؟`"
      type="error"
      confirm-text="حذف"
      cancel-text="إلغاء"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue';
import { useUsersStore } from '@/stores/users';
import { useInventoryStore } from '@/stores/inventory';
import { useNotificationStore } from '@/stores/notification';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

const store = useUsersStore();
const inventoryStore = useInventoryStore();
const notification = useNotificationStore();

const isGlobalRole = (role) => role === 'admin' || role === 'global_admin';

const warehousesForForm = computed(() =>
  inventoryStore.warehouses.filter((w) => w.branchId === form.assignedBranchId)
);

const onBranchChange = () => {
  form.assignedWarehouseId = null;
};

const deleteDialog = ref(false);
const selectedItem = ref(null);

const headers = [
  { title: 'المعرف', key: 'id' },
  { title: 'اسم المستخدم', key: 'username' },
  { title: 'الاسم الكامل', key: 'fullName' },
  { title: 'الهاتف', key: 'phone' },
  { title: 'الدور', key: 'role' },
  { title: 'الحالة', key: 'isActive' },
  { title: 'إجراءات', key: 'actions', sortable: false },
];

const statusOptions = [
  { title: 'نشط', value: true },
  { title: 'معطل', value: false },
];

const roleOptions = [
  { title: 'مدير عام', value: 'global_admin' },
  { title: 'مدير فرع', value: 'branch_admin' },
  { title: 'مسؤول فرع', value: 'branch_manager' },
  { title: 'مدير متجر', value: 'manager' },
  { title: 'كاشير', value: 'cashier' },
  { title: 'مشاهد', value: 'viewer' },
  { title: 'مدير (قديم)', value: 'admin' },
];

const showForm = ref(false);
const formRef = ref(null);
const resetPwDialog = ref(false);
const resetPwRef = ref(null);

const rules = {
  required: (value) => !!value || 'هذا الحقل مطلوب.',
  minLength: (value) => value.length >= 6 || 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.',
  confirmPassword: (value) =>
    value === resetPwInfo.confirmPassword || 'كلمتا المرور غير متطابقتين.',
};

const form = reactive({
  id: null,
  username: '',
  fullName: '',
  phone: '',
  role: 'cashier',
  password: '',
  isActive: true,
  assignedBranchId: null,
  assignedWarehouseId: null,
});
const resetPwInfo = reactive({
  newPassword: '',
  confirmPassword: '',
  userId: null,
});

function getRoleName(role) {
  const roleOption = roleOptions.find((r) => r.value === role);
  return roleOption ? roleOption.title : role || '-';
}

function openForm(item) {
  if (item) {
    Object.assign(form, {
      ...item,
      assignedBranchId: item.assignedBranchId ?? null,
      assignedWarehouseId: item.assignedWarehouseId ?? null,
      password: '',
    });
  } else {
    Object.assign(form, {
      id: null,
      username: '',
      fullName: '',
      phone: '',
      role: 'cashier',
      password: '',
      isActive: true,
      assignedBranchId: null,
      assignedWarehouseId: null,
    });
  }
  showForm.value = true;
}

function openResetPwDialog(item) {
  resetPwInfo.userId = item.id;
  resetPwDialog.value = true;
}

function closeResetPwDialog() {
  resetPwDialog.value = false;
  resetPwInfo.newPassword = '';
  resetPwInfo.confirmPassword = '';
  resetPwInfo.userId = null;
}

async function save() {
  const assignedPayload = isGlobalRole(form.role)
    ? { assignedBranchId: null, assignedWarehouseId: null }
    : {
        assignedBranchId: form.assignedBranchId,
        assignedWarehouseId: form.assignedWarehouseId || null,
      };

  if (form.id) {
    await store.update(form.id, {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      isActive: form.isActive,
      ...assignedPayload,
    });
  } else {
    try {
      await store.create({
        username: form.username,
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        password: form.password,
        ...assignedPayload,
      });
    } catch (error) {
      notification.error(error.message);
    }
  }
  showForm.value = false;
  await store.fetch();
}

async function remove(item) {
  selectedItem.value = item;
  deleteDialog.value = true;
}

async function confirmDelete() {
  if (selectedItem.value) {
    await store.remove(selectedItem.value.id);
    selectedItem.value = null;
  }
}

async function resetPw() {
  const { valid } = await resetPwRef.value.validate();
  if (!valid) return;
  if (resetPwInfo.newPassword !== resetPwInfo.confirmPassword) {
    notification.error('كلمتا المرور غير متطابقتين!');
    return;
  }
  await store.resetPassword(resetPwInfo.userId, resetPwInfo.newPassword);
  closeResetPwDialog();
}

onMounted(async () => {
  await Promise.all([
    store.fetch(),
    inventoryStore.fetchBranches(),
    inventoryStore.fetchWarehouses(),
  ]);
});
</script>
