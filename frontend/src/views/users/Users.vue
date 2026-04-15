<template>
  <div class="space-y-6">
    <!-- 🔹 لوحة البحث والفلترة -->
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة المستخدمين</div>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openForm()">مستخدم جديد</v-btn>
      </div>
    </v-card>

    <v-card class="mb-4">
      <v-card-text>
        <v-row dense class="flex justify-center items-center">
          <v-col cols="12" md="4">
            <v-text-field
              v-model="store.filters.search"
              label="بحث بالاسم"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="comfortable"
              clearable
              @keyup.enter="store.fetch()"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="store.filters.role"
              :items="roleOptions"
              label="الدور"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              clearable
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="store.filters.isActive"
              :items="statusOptions"
              label="الحالة"
              variant="outlined"
              density="comfortable"
              clearable
            />
          </v-col>
          <v-col cols="12">
            <v-btn color="primary" variant="flat" @click="store.fetch()">تحديث</v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- 🔹 جدول المستخدمين -->
    <v-card>
      <v-data-table
        :items="store.list"
        :loading="store.loading"
        :headers="headers"
        :items-per-page="store.limit"
        class="elevation-0"
      >
        <template #loading>
          <v-skeleton-loader type="table"></v-skeleton-loader>
        </template>

        <template #[`item.role`]="{ item }">
          <v-chip color="primary" variant="flat" size="small">
            {{ getRoleName(item.role) }}
          </v-chip>
        </template>

        <template #[`item.isActive`]="{ item }">
          <v-chip :color="item.isActive ? 'success' : 'grey'" variant="flat" size="small">
            {{ item.isActive ? 'نشط' : 'معطل' }}
          </v-chip>
        </template>

        <template #[`item.actions`]="{ item }">
          <v-btn icon variant="text" color="primary" @click="openForm(item)">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn icon variant="text" color="warning" @click="openResetPwDialog(item)">
            <v-icon>mdi-lock-reset</v-icon>
          </v-btn>
          <v-btn icon variant="text" color="error" @click="remove(item)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- 🔹 نافذة إنشاء/تعديل المستخدم -->
    <v-dialog v-model="showForm" max-width="600">
      <v-card elevation="10" rounded="xl">
        <v-card-title class="bg-secondary text-white">
          {{ form.id ? 'تعديل مستخدم' : 'مستخدم جديد' }}
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <v-form ref="formRef" class="space-y-3" @submit.prevent="save">
            <v-text-field
              v-model="form.username"
              label="اسم المستخدم"
              :disabled="!!form.id"
              required
              variant="outlined"
            />
            <v-text-field
              v-model="form.fullName"
              label="الاسم الكامل"
              required
              variant="outlined"
            />
            <v-text-field v-model="form.phone" label="الهاتف" variant="outlined" />
            <v-select
              v-model="form.role"
              :items="roleOptions"
              item-title="title"
              item-value="value"
              label="الدور"
              required
              variant="outlined"
            />
            <v-text-field
              v-if="!form.id"
              v-model="form.password"
              label="كلمة المرور"
              type="password"
              required
              variant="outlined"
            />
            <v-switch v-model="form.isActive" label="نشط" color="primary" inset />
          </v-form>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions class="justify-end gap-2">
          <v-btn color="primary" variant="elevated" @click="save">حفظ</v-btn>
          <v-spacer />
          <v-btn variant="text" @click="showForm = false">إلغاء</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- تغير كلمة المرور🔹 -->
    <v-dialog v-model="resetPwDialog" max-width="600">
      <!-- محتوى حوار تغيير كلمة المرور -->
      <v-card elevation="10" rounded="xl">
        <v-card-title class="bg-secondary text-white"> تغيير كلمة المرور </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <v-form ref="resetPwRef" lazy-validation @submit.prevent="resetPw">
            <v-text-field
              v-model="resetPwInfo.newPassword"
              label="كلمة المرور الجديدة"
              type="password"
              :rules="[rules.required, rules.minLength]"
              variant="outlined"
            />
            <v-text-field
              v-model="resetPwInfo.confirmPassword"
              label="تأكيد كلمة المرور"
              type="password"
              :rules="[
                rules.required,
                rules.confirmPassword(resetPwInfo.newPassword),
                rules.minLength,
              ]"
              variant="outlined"
            />

            <div class="flex justify-space-between align-center mt-3">
              <v-btn
                type="submit"
                color="primary"
                class="tracking-wide shadow-lg hover:shadow-xl transition-all duration-300"
                >تغيير كلمة المرور</v-btn
              >
              <v-btn variant="text" @click="closeResetPwDialog">إلغاء</v-btn>
            </div>
          </v-form>
        </v-card-text>
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
import { ref, onMounted, reactive } from 'vue';
import { useUsersStore } from '@/stores/users';
import { useNotificationStore } from '@/stores/notification';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

const store = useUsersStore();
const notification = useNotificationStore();

// Delete dialog state
const deleteDialog = ref(false);
const selectedItem = ref(null);

const headers = [
  { title: 'المعرف', key: 'id' },
  { title: 'اسم المستخدم', key: 'username' },
  { title: 'الاسم الكامل', key: 'fullName' },
  { title: 'الهاتف', key: 'phone' },
  { title: 'الدور', key: 'role' },
  { title: 'الحالة', key: 'isActive' },
  { title: 'خيارات', key: 'actions', sortable: false },
];

const statusOptions = [
  { title: 'نشط', value: true },
  { title: 'معطل', value: false },
];

// Role enum options
const roleOptions = [
  { title: 'مدير', value: 'admin' },
  { title: 'كاشير', value: 'cashier' },
  { title: 'مدير متجر', value: 'manager' },
  { title: 'مشاهد', value: 'viewer' },
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
  if (item) Object.assign(form, item);
  else
    Object.assign(form, {
      id: null,
      username: '',
      fullName: '',
      phone: '',
      role: 'cashier',
      password: '',
      isActive: true,
    });
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
  if (form.id) {
    await store.update(form.id, {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      isActive: form.isActive,
    });
  } else {
    try {
      await store.create({
        username: form.username,
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        password: form.password,
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
  await store.fetch();
});
</script>
