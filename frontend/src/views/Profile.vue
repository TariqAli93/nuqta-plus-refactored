<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="me-2" color="primary">mdi-account-circle</v-icon>
            <span>الملف الشخصي</span>
          </v-card-title>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <!-- User Information Card -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="me-2">mdi-account</v-icon>
            <span>معلومات المستخدم</span>
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text>
            <v-list lines="two">
              <v-list-item>
                <template #prepend>
                  <v-icon>mdi-account</v-icon>
                </template>
                <v-list-item-title>اسم المستخدم</v-list-item-title>
                <v-list-item-subtitle>{{ authStore.currentUser?.username }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template #prepend>
                  <v-icon>mdi-shield-account</v-icon>
                </template>
                <v-list-item-title>الدور الوظيفي</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip
                    size="small"
                    :color="getRoleColor(authStore.currentUser?.role?.name)"
                    class="mt-1"
                  >
                    {{ authStore.currentUser?.role?.name || 'غير محدد' }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template #prepend>
                  <v-icon>mdi-calendar</v-icon>
                </template>
                <v-list-item-title>تاريخ الإنشاء</v-list-item-title>
                <v-list-item-subtitle>{{
                  formatDate(authStore.currentUser?.createdAt)
                }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Change Password Card -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="me-2">mdi-lock-reset</v-icon>
            <span>تغيير كلمة المرور</span>
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text>
            <v-form ref="passwordForm" @submit.prevent="changePassword">
              <v-text-field
                v-model="passwordData.currentPassword"
                label="كلمة المرور الحالية"
                :type="showCurrentPassword ? 'text' : 'password'"
                :append-inner-icon="showCurrentPassword ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="[rules.required]"
                prepend-inner-icon="mdi-lock"
                variant="outlined"
                density="comfortable"
                class="mb-2"
                @click:append-inner="showCurrentPassword = !showCurrentPassword"
              ></v-text-field>

              <v-text-field
                v-model="passwordData.newPassword"
                label="كلمة المرور الجديدة"
                :type="showNewPassword ? 'text' : 'password'"
                :append-inner-icon="showNewPassword ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="[rules.required, rules.minLength]"
                prepend-inner-icon="mdi-lock-plus"
                variant="outlined"
                density="comfortable"
                class="mb-2"
                @click:append-inner="showNewPassword = !showNewPassword"
              ></v-text-field>

              <v-text-field
                v-model="passwordData.confirmPassword"
                label="تأكيد كلمة المرور الجديدة"
                :type="showConfirmPassword ? 'text' : 'password'"
                :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
                :rules="[rules.required, rules.passwordMatch]"
                prepend-inner-icon="mdi-lock-check"
                variant="outlined"
                density="comfortable"
                class="mb-2"
                @click:append-inner="showConfirmPassword = !showConfirmPassword"
              ></v-text-field>

              <v-btn
                type="submit"
                color="primary"
                :loading="loading"
                :disabled="loading"
                block
                class="mt-2"
              >
                <v-icon start>mdi-content-save</v-icon>
                تغيير كلمة المرور
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Permissions Card -->
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="me-2">mdi-shield-lock</v-icon>
            <span>الصلاحيات</span>
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text>
            <v-alert v-if="!userPermissions.length" type="info" variant="tonal" class="mb-0">
              <v-icon start>mdi-information</v-icon>
              لا توجد صلاحيات محددة لهذا المستخدم
            </v-alert>
            <v-chip-group v-else column>
              <v-chip
                v-for="permission in userPermissions"
                :key="permission"
                size="default"
                color="primary"
                variant="tonal"
              >
                <v-icon start size="small">mdi-check-circle</v-icon>
                {{ getPermissionLabel(permission) }}
              </v-chip>
            </v-chip-group>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import api from '@/plugins/axios';

const authStore = useAuthStore();
const notificationStore = useNotificationStore();

const passwordForm = ref(null);
const loading = ref(false);
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

const passwordData = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const rules = {
  required: (value) => !!value || 'هذا الحقل مطلوب',
  minLength: (value) => (value && value.length >= 8) || 'يجب أن تكون كلمة المرور 8 أحرف على الأقل',
  passwordMatch: (value) => value === passwordData.value.newPassword || 'كلمة المرور غير متطابقة',
};

const userPermissions = computed(() => {
  return authStore.currentUser?.permissions || [];
});

const getRoleColor = (roleName) => {
  const colors = {
    مدير: 'error',
    محاسب: 'primary',
    مبيعات: 'success',
    مستخدم: 'info',
  };
  return colors[roleName] || 'grey';
};

const formatDate = (dateString) => {
  if (!dateString) return 'غير محدد';
  const date = new Date(dateString);
  return date.toLocaleDateString('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  });
};

const getPermissionLabel = (permission) => {
  const labels = {
    'read:dashboard': 'عرض لوحة التحكم',
    'read:customers': 'عرض العملاء',
    'create:customers': 'إضافة عملاء',
    'update:customers': 'تعديل العملاء',
    'delete:customers': 'حذف العملاء',
    'manage:customers': 'إدارة العملاء',
    'read:products': 'عرض المنتجات',
    'create:products': 'إضافة منتجات',
    'update:products': 'تعديل المنتجات',
    'delete:products': 'حذف المنتجات',
    'manage:products': 'إدارة المنتجات',
    'read:categories': 'عرض الفئات',
    'create:categories': 'إضافة فئات',
    'update:categories': 'تعديل الفئات',
    'delete:categories': 'حذف الفئات',
    'manage:categories': 'إدارة الفئات',
    'read:sales': 'عرض المبيعات',
    'create:sales': 'إضافة مبيعات',
    'update:sales': 'تعديل المبيعات',
    'delete:sales': 'حذف المبيعات',
    'manage:sales': 'إدارة المبيعات',
    'read:reports': 'عرض التقارير',
    'manage:reports': 'إدارة التقارير',
    'read:users': 'عرض المستخدمين',
    'create:users': 'إضافة مستخدمين',
    'update:users': 'تعديل المستخدمين',
    'delete:users': 'حذف المستخدمين',
    'manage:users': 'إدارة المستخدمين',
    'read:roles': 'عرض الأدوار',
    'create:roles': 'إضافة أدوار',
    'update:roles': 'تعديل الأدوار',
    'delete:roles': 'حذف الأدوار',
    'manage:roles': 'إدارة الأدوار',
    'read:permissions': 'عرض الصلاحيات',
    'read:settings': 'عرض الإعدادات',
    'update:settings': 'تعديل الإعدادات',
    'view:sales': 'عرض صفحة المبيعات',
    'view:customers': 'عرض صفحة العملاء',
    'view:products': 'عرض صفحة المنتجات',
    'view:categories': 'عرض صفحة الفئات',
    'view:reports': 'عرض صفحة التقارير',
    'view:users': 'عرض صفحة المستخدمين',
    'view:roles': 'عرض صفحة الأدوار',
    'view:permissions': 'عرض صفحة الصلاحيات',
    'view:settings': 'عرض صفحة الإعدادات',
    'view:dashboard': 'عرض صفحة لوحة التحكم',
    'manage:permissions': 'إدارة الصلاحيات',
    'manage:settings': 'إدارة الإعدادات',
    'manage:*': 'صلاحيات كاملة (مدير النظام)',
  };
  return labels[permission] || permission;
};

const changePassword = async () => {
  const { valid } = await passwordForm.value.validate();
  if (!valid) return;

  loading.value = true;
  try {
    await api.put('/auth/change-password', {
      currentPassword: passwordData.value.currentPassword,
      newPassword: passwordData.value.newPassword,
    });

    notificationStore.success('تم تغيير كلمة المرور بنجاح');

    // Reset form
    passwordData.value = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    };
    passwordForm.value.reset();
  } catch (error) {
    const errorMessage = error?.message || 'فشل تغيير كلمة المرور';
    notificationStore.error(errorMessage);
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped></style>
