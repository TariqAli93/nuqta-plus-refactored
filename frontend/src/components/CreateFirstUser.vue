<template>
  <v-dialog v-model="isFirstRunDialog" max-width="780" persistent>
    <v-card elevation="12" rounded="xl">
      <v-card-title class="py-6 text-center">
        <v-icon color="primary" size="64" class="mb-2">mdi-party-popper</v-icon>
        <h2 class="mb-1 font-semibold text-h5 text-primary">🎉 مرحباً بك في نظام nuqtaplus 🎉</h2>
        <p class="text-gray-600 text-body-2">
          خطوتان سريعتان: إنشاء حساب المدير ثم إعداد معلومات الشركة.
        </p>
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-stepper v-model="step" flat>
          <v-stepper-header>
            <v-stepper-item :value="1" title="إنشاء حساب المدير" prepend-icon="mdi-account-plus" />
            <v-stepper-item :value="2" title="معلومات الشركة" prepend-icon="mdi-domain" />
          </v-stepper-header>

          <v-stepper-window>
            <v-stepper-window-item :value="1">
              <v-form ref="userFormRef" v-model="userFormValid">
                <v-row class="mt-4">
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="username"
                      label="اسم المستخدم"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-account"
                      :rules="[rules.required, rules.maxLength(100)]"
                    />
                  </v-col>
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="password"
                      label="كلمة المرور"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-lock"
                      :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                      :type="showPassword ? 'text' : 'password'"
                      :rules="[rules.required, rules.minLength(8)]"
                      @click:append-inner="showPassword = !showPassword"
                    />
                  </v-col>
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="fullName"
                      label="الاسم الكامل"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-card-account-details"
                      :rules="[rules.required, rules.maxLength(255)]"
                    />
                  </v-col>
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="phone"
                      label="رقم الهاتف"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-phone"
                      :rules="[rules.validPhone]"
                    />
                  </v-col>
                </v-row>
              </v-form>

              <v-alert type="info" variant="tonal" class="mt-3">
                سيتم إنشاء حساب مدير بصلاحيات كاملة. يمكنك تعديل البيانات قبل الإكمال.
              </v-alert>

              <div class="justify-end gap-2 mt-4 d-flex">
                <v-btn color="primary" :loading="loadingUser" @click="handleCreateUser">
                  التالي
                  <v-icon end>mdi-arrow-left</v-icon>
                </v-btn>
              </div>
            </v-stepper-window-item>

            <v-stepper-window-item :value="2">
              <v-form ref="companyFormRef" v-model="companyFormValid">
                <v-row class="mt-4">
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="companyData.name"
                      label="اسم الشركة"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-domain"
                      :rules="[rules.required, rules.maxLength(255)]"
                    />
                  </v-col>
                  <v-col cols="12" md="6">
                    <v-select
                      v-model="companyData.invoiceType"
                      :items="invoiceTypes"
                      item-title="text"
                      item-value="value"
                      label="نوع الفاتورة الافتراضي"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-receipt"
                    />
                  </v-col>

                  <v-col cols="12" md="4">
                    <v-text-field
                      v-model="companyData.city"
                      label="المدينة"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-city"
                      :rules="[rules.required, rules.maxLength(100)]"
                    />
                  </v-col>
                  <v-col cols="12" md="4">
                    <v-text-field
                      v-model="companyData.area"
                      label="المنطقة"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-map-outline"
                      :rules="[rules.required, rules.maxLength(100)]"
                    />
                  </v-col>
                  <v-col cols="12" md="4">
                    <v-text-field
                      v-model="companyData.street"
                      label="الشارع"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-road"
                      :rules="[rules.required, rules.maxLength(200)]"
                    />
                  </v-col>

                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="companyData.phone"
                      label="رقم الهاتف"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-phone"
                      :rules="[rules.validPhone]"
                    />
                  </v-col>
                  <v-col cols="12" md="6">
                    <v-text-field
                      v-model="companyData.phone2"
                      label="رقم هاتف إضافي"
                      variant="outlined"
                      density="comfortable"
                      prepend-inner-icon="mdi-phone"
                      :rules="[rules.validPhone]"
                    />
                  </v-col>
                </v-row>
              </v-form>

              <div class="gap-2 mt-4 d-flex justify-space-between">
                <v-btn variant="text" prepend-icon="mdi-arrow-right" @click="step = 1"
                  >السابق</v-btn
                >
                <v-btn color="primary" :loading="loadingCompany" @click="handleSaveCompany">
                  حفظ وإنهاء
                </v-btn>
              </div>
            </v-stepper-window-item>
          </v-stepper-window>
        </v-stepper>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import { useBackendStateStore } from '@/stores/backendState';
import { useConnectionStore } from '@/stores/connection';
import api from '@/plugins/axios';

// Stores
const authStore = useAuthStore();
const notification = useNotificationStore();
const backendStore = useBackendStateStore();
const connectionStore = useConnectionStore();

// State
const isFirstRunDialog = ref(false);
const step = ref(1);
const loadingUser = ref(false);
const loadingCompany = ref(false);
// Cache the user-step values so the company step can submit them in a single
// /api/setup/first-run call (the backend creates user + company atomically).
const pendingUser = ref(null);

// Forms
const userFormRef = ref(null);
const companyFormRef = ref(null);
const userFormValid = ref(false);
const companyFormValid = ref(false);

// User fields
const username = ref('admin');
const password = ref('Admin@123');
const showPassword = ref(false);
const fullName = ref('مدير النظام');
const phone = ref('');

// Company fields
const invoiceTypes = [
  { text: 'فاتورة A4', value: 'a4' },
  { text: 'فاتورة A5', value: 'a5' },
  { text: 'رول حراري 58mm', value: 'roll-58' },
  { text: 'رول حراري 80mm', value: 'roll-80' },
  { text: 'رول حراري 88mm', value: 'roll-88' },
];

const companyData = ref({
  name: '',
  city: '',
  area: '',
  street: '',
  phone: '',
  phone2: '',
  invoiceType: invoiceTypes[0].value,
});

/**
 * Probe /api/setup/status. Backend is the single source of truth — we never
 * cache the result in localStorage so a fresh install always re-evaluates.
 *
 * Skipped in client mode: FirstRun is the server admin's responsibility on the
 * machine that owns the database, not on every workstation that connects.
 */
async function refreshSetupStatus() {
  if (connectionStore.isClientMode) return;
  try {
    const status = await api.get('/setup/status');
    if (status?.setupRequired) {
      isFirstRunDialog.value = true;
    } else {
      isFirstRunDialog.value = false;
    }
  } catch {
    // Network/early-startup failures: don't show FirstRun. Backend will be
    // re-probed once it transitions to 'ready'.
    isFirstRunDialog.value = false;
  }
}

onMounted(() => {
  if (backendStore.status === 'ready') {
    refreshSetupStatus();
  }
});

// Re-check setup status whenever the local backend transitions to ready —
// covers the cold-start case where the renderer mounts before /health passes.
watch(
  () => backendStore.status,
  (status) => {
    if (status === 'ready') refreshSetupStatus();
  }
);

function closeDialog() {
  isFirstRunDialog.value = false;
  authStore.isFirstRun = false;
}

// Validation rules
const rules = {
  required: (value) => !!value || 'هذا الحقل مطلوب',
  maxLength: (max) => (value) => !value || value.length <= max || `يجب ألا يتجاوز ${max} حرف`,
  minLength: (min) => (value) => !value || value.length >= min || `يجب ألا يقل عن ${min} أحرف`,
  validPhone: (value) => {
    if (!value) return true;
    return /^\d{10,15}$/.test(value) || 'رقم الهاتف غير صحيح';
  },
};

// Step 1: validate the admin-user form and advance to the company step.
// Creation is deferred to step 2 so user + company are persisted in a single
// idempotent /api/setup/first-run call (matches the backend contract).
const handleCreateUser = async () => {
  if (!userFormRef.value) return;
  const { valid } = await userFormRef.value.validate();
  if (!valid) return;
  loadingUser.value = true;
  try {
    pendingUser.value = {
      username: username.value,
      password: password.value,
      fullName: fullName.value,
      phone: phone.value,
    };
    step.value = 2;
  } finally {
    loadingUser.value = false;
  }
};

// Step 2: submit the combined first-run payload, then sign in so the dashboard
// loads without a second prompt.
const handleSaveCompany = async () => {
  if (!companyFormRef.value) return;
  const { valid } = await companyFormRef.value.validate();
  if (!valid) return;
  if (!pendingUser.value) {
    step.value = 1;
    return;
  }
  loadingCompany.value = true;
  try {
    await api.post('/setup/first-run', {
      ...pendingUser.value,
      company: { ...companyData.value },
    });

    await authStore.login({
      username: pendingUser.value.username,
      password: pendingUser.value.password,
    });

    closeDialog();
    pendingUser.value = null;
  } catch (error) {
    const errorMessage =
      error?.errors?.[0]?.message ||
      error?.message ||
      error?.response?.data?.message ||
      'تعذر إكمال الإعداد الأولي. يرجى المحاولة مرة أخرى.';
    notification.error(errorMessage);
  } finally {
    loadingCompany.value = false;
  }
};
</script>

<style scoped>
.space-y-4 > * + * {
  margin-top: 1rem;
}
</style>
