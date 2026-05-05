<template>
  <!-- ── Setup error dialog ────────────────────────────────────────────────
       Shown whenever /api/setup/status reports setupRequired=true with a
       reason other than NO_ADMIN_USER / NO_COMPANY_SETTINGS. The renderer
       trusts the backend reason verbatim so the user sees the exact root
       cause, not a generic "Database is not available". -->
  <v-dialog v-if="setupErrorVisible" v-model="setupErrorVisible" max-width="640" persistent>
    <v-card elevation="12" rounded="xl">
      <v-card-title class="py-5 text-center">
        <v-icon :color="errorIconColor" size="56" class="mb-2">{{ errorIcon }}</v-icon>
        <h2 class="font-semibold text-h6">{{ errorHeadline }}</h2>
      </v-card-title>

      <v-divider />

      <v-card-text class="pt-4">
        <v-alert
          :type="errorAlertType"
          variant="tonal"
          density="comfortable"
          class="mb-4"
        >
          <div class="text-body-2">{{ errorDescription }}</div>
          <div v-if="errorRemediation" class="text-caption mt-1 text-medium-emphasis">
            {{ errorRemediation }}
          </div>
        </v-alert>

        <!-- Per-reason details panel — only shows fields the backend provided. -->
        <v-list density="compact" class="pa-0">
          <template v-for="line in detailLines" :key="line.label">
            <v-list-item>
              <v-list-item-title class="text-caption text-medium-emphasis">
                {{ line.label }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-body-2" style="white-space: pre-wrap">
                {{ line.value }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-list>

        <!-- Missing/existing tables, migration candidates collapsed by default. -->
        <v-expansion-panels v-if="hasAdvancedDetails" variant="accordion" class="mt-3">
          <v-expansion-panel v-if="setupStatus?.missingTables?.length">
            <v-expansion-panel-title>
              الجداول المفقودة ({{ setupStatus.missingTables.length }})
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-chip-group column>
                <v-chip
                  v-for="t in setupStatus.missingTables"
                  :key="t"
                  size="small"
                  variant="outlined"
                  color="error"
                >{{ t }}</v-chip>
              </v-chip-group>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel v-if="setupStatus?.existingTables?.length">
            <v-expansion-panel-title>
              الجداول الموجودة ({{ setupStatus.existingTables.length }})
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-chip-group column>
                <v-chip
                  v-for="t in setupStatus.existingTables"
                  :key="t"
                  size="small"
                  variant="outlined"
                >{{ t }}</v-chip>
              </v-chip-group>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel v-if="migrationCandidates.length">
            <v-expansion-panel-title>
              مسارات الترحيل التي تم البحث فيها ({{ migrationCandidates.length }})
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-list density="compact" class="pa-0">
                <v-list-item v-for="c in migrationCandidates" :key="c.path">
                  <v-list-item-title class="text-body-2 text-break">
                    {{ c.path }}
                  </v-list-item-title>
                  <v-list-item-subtitle class="text-caption">
                    exists={{ c.exists }} dir={{ c.isDirectory }}
                    journal={{ c.hasJournal }} sql={{ c.sqlFileCount }}
                    valid={{ c.valid }}
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 d-flex justify-space-between flex-wrap gap-2">
        <v-btn
          variant="text"
          prepend-icon="mdi-content-copy"
          :loading="copyingDiagnostics"
          @click="handleCopyDiagnostics"
        >
          نسخ معلومات التشخيص
        </v-btn>

        <div class="d-flex gap-2">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-refresh"
            :loading="refreshing"
            @click="refreshSetupStatus"
          >
            إعادة المحاولة
          </v-btn>
        </div>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- ── First-run stepper (admin + company) ─────────────────────────────── -->
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
import { ref, computed, onMounted, watch } from 'vue';
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

// FirstRun stepper visibility — only when reason ∈ {NO_ADMIN_USER, NO_COMPANY_SETTINGS}.
const isFirstRunDialog = ref(false);
const step = ref(1);
const loadingUser = ref(false);
const loadingCompany = ref(false);

// Cache the user-step values so the company step can submit them in a single
// /api/setup/first-run call (the backend creates user + company atomically).
const pendingUser = ref(null);

// Latest /api/setup/status payload (or a synthesised one when /first-run rejects).
const setupStatus = ref(null);
const refreshing = ref(false);
const copyingDiagnostics = ref(false);

// Reasons that mean "schema/connection broken" — the user can't proceed past
// the setup error screen until the operator fixes the underlying problem.
const SCHEMA_FAILURE_REASONS = new Set([
  'DATABASE_CONNECTION_FAILED',
  'WRONG_DATABASE_CONNECTED',
  'INSUFFICIENT_SCHEMA_PRIVILEGES',
  'MIGRATIONS_FOLDER_NOT_FOUND',
  'MIGRATIONS_NOT_ATTEMPTED',
  'MIGRATIONS_SKIPPED',
  'MIGRATION_FAILED',
  'MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING',
  'SCHEMA_NOT_READY',
]);

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

// ── Setup error rendering ────────────────────────────────────────────────
const setupErrorVisible = computed({
  get: () => {
    const s = setupStatus.value;
    if (!s || !s.setupRequired) return false;
    return SCHEMA_FAILURE_REASONS.has(s.reason);
  },
  set: () => {
    // Persistent dialog — never closed by clicking outside.
  },
});

const REASON_TEXT = {
  DATABASE_CONNECTION_FAILED: {
    headline: 'فشل الاتصال بقاعدة البيانات',
    description: 'لم يتمكن النظام من الاتصال بخادم قاعدة البيانات.',
    remediation: 'تأكد من تشغيل PostgreSQL وصحة إعدادات الاتصال (المضيف، المنفذ، المستخدم).',
    icon: 'mdi-database-off',
    color: 'error',
  },
  WRONG_DATABASE_CONNECTED: {
    headline: 'تم الاتصال بقاعدة بيانات غير صحيحة',
    description: 'اسم قاعدة البيانات الفعلي لا يطابق الاسم المحدد في الإعدادات.',
    remediation: 'حدّث PG_DATABASE / DATABASE_URL لاسم قاعدة البيانات الصحيح ثم أعد تشغيل الخدمة.',
    icon: 'mdi-database-alert',
    color: 'error',
  },
  INSUFFICIENT_SCHEMA_PRIVILEGES: {
    headline: 'مستخدم قاعدة البيانات لا يملك صلاحية إنشاء جداول',
    description: 'الحساب الذي يتصل بقاعدة البيانات لا يمتلك صلاحية CREATE على المخطّط public.',
    remediation: 'امنح المستخدم صلاحية CREATE على schema public أو استخدم حساباً يملكها.',
    icon: 'mdi-shield-alert',
    color: 'warning',
  },
  MIGRATIONS_FOLDER_NOT_FOUND: {
    headline: 'لم يتم العثور على ملفات الترحيل',
    description: 'مجلد ترحيلات قاعدة البيانات (drizzle) غير موجود ضمن نسخة التطبيق المثبتة.',
    remediation: 'أعد تثبيت NuqtaPlus Server — مجلد drizzle مفقود من resources/backend.',
    icon: 'mdi-folder-remove',
    color: 'error',
  },
  MIGRATIONS_NOT_ATTEMPTED: {
    headline: 'لم تتم محاولة تنفيذ الترحيلات',
    description: 'الترحيلات لم تُنفّذ في هذه الجلسة.',
    remediation: 'راجع سجلات الخادم لمعرفة سبب التخطّي ثم أعد تشغيل الخدمة.',
    icon: 'mdi-timer-sand',
    color: 'warning',
  },
  MIGRATIONS_SKIPPED: {
    headline: 'تم تخطّي ترحيلات قاعدة البيانات',
    description: 'الإعدادات الحالية تتسبّب في تخطّي مرحلة الترحيل.',
    remediation: 'أزل MIGRATIONS_DISABLED أو صحّح متغيرات البيئة، ثم أعد تشغيل الخدمة.',
    icon: 'mdi-skip-next-circle',
    color: 'warning',
  },
  MIGRATION_FAILED: {
    headline: 'فشل تنفيذ ترحيلات قاعدة البيانات',
    description: 'بدأ تنفيذ الترحيلات لكن تعطّل قبل الاكتمال.',
    remediation: 'افحص رسالة الخطأ أدناه وراجع سجلات الخادم لمزيد من التفاصيل.',
    icon: 'mdi-database-remove',
    color: 'error',
  },
  MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING: {
    headline: 'اكتملت الترحيلات لكن الجداول المطلوبة مفقودة',
    description: 'أبلغ مشغّل الترحيلات عن النجاح لكن بعض الجداول الأساسية غير موجودة.',
    remediation: 'تأكد من عدم الاتصال بقاعدة بيانات أخرى تحمل نفس الاسم، أو أعد التشغيل من قاعدة نظيفة.',
    icon: 'mdi-table-remove',
    color: 'warning',
  },
  SCHEMA_NOT_READY: {
    headline: 'قاعدة البيانات غير جاهزة',
    description: 'الترحيلات لم تكتمل، لذلك بعض الجداول المطلوبة غير موجودة.',
    remediation: 'راجع سجلات الخادم لمعرفة السبب الدقيق ثم أعد تشغيل الخدمة.',
    icon: 'mdi-database-clock',
    color: 'warning',
  },
};

const reasonText = computed(
  () => REASON_TEXT[setupStatus.value?.reason] || REASON_TEXT.SCHEMA_NOT_READY
);
const errorHeadline = computed(() => reasonText.value.headline);
const errorDescription = computed(
  () => setupStatus.value?.details || reasonText.value.description
);
const errorRemediation = computed(() => reasonText.value.remediation);
const errorIcon = computed(() => reasonText.value.icon);
const errorIconColor = computed(() => reasonText.value.color);
const errorAlertType = computed(() =>
  reasonText.value.color === 'error' ? 'error' : 'warning'
);

const detailLines = computed(() => {
  const s = setupStatus.value;
  if (!s) return [];
  const lines = [{ label: 'السبب', value: s.reason || 'unknown' }];

  if (s.reason === 'DATABASE_CONNECTION_FAILED') {
    const cfg = s.configured;
    if (cfg) {
      lines.push({
        label: 'الخادم',
        value: `${cfg.host || ''}:${cfg.port ?? ''}`,
      });
      if (cfg.database) lines.push({ label: 'قاعدة البيانات', value: cfg.database });
      if (cfg.user) lines.push({ label: 'المستخدم', value: cfg.user });
    }
  }
  if (s.reason === 'WRONG_DATABASE_CONNECTED') {
    if (s.expectedDatabase) lines.push({ label: 'المتوقّع', value: s.expectedDatabase });
    if (s.actualDatabase) lines.push({ label: 'الفعلي', value: s.actualDatabase });
  }
  if (s.reason === 'INSUFFICIENT_SCHEMA_PRIVILEGES') {
    if (s.user) lines.push({ label: 'المستخدم', value: s.user });
    if (s.database) lines.push({ label: 'قاعدة البيانات', value: s.database });
    if (s.schema) lines.push({ label: 'المخطّط', value: s.schema });
    if (s.missingPrivilege)
      lines.push({ label: 'الصلاحية المفقودة', value: s.missingPrivilege });
  }
  if (s.reason === 'MIGRATIONS_FOLDER_NOT_FOUND') {
    if (s.migrations?.candidates?.length) {
      lines.push({
        label: 'عدد المسارات المُجرَّبة',
        value: String(s.migrations.candidates.length),
      });
    }
  }
  if (s.reason === 'MIGRATION_FAILED' && s.migrations?.errorMessage) {
    lines.push({ label: 'رسالة الخطأ', value: s.migrations.errorMessage });
    if (s.migrations.folderSelected) {
      lines.push({ label: 'مجلد الترحيلات', value: s.migrations.folderSelected });
    }
  }
  if (s.reason === 'MIGRATIONS_NOT_ATTEMPTED' && s.migrations?.skipReason) {
    lines.push({ label: 'سبب التخطي', value: s.migrations.skipReason });
  }
  if (s.reason === 'MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING') {
    if (s.folderSelected) {
      lines.push({ label: 'مجلد الترحيلات', value: s.folderSelected });
    }
    if (typeof s.sqlFileCount === 'number') {
      lines.push({ label: 'عدد ملفات SQL', value: String(s.sqlFileCount) });
    }
  }
  return lines;
});

const migrationCandidates = computed(() => setupStatus.value?.migrations?.candidates || []);
const hasAdvancedDetails = computed(
  () =>
    !!(
      setupStatus.value?.missingTables?.length ||
      setupStatus.value?.existingTables?.length ||
      migrationCandidates.value.length
    )
);

/**
 * Probe /api/setup/status. Backend is the single source of truth — we never
 * cache the result in localStorage so a fresh install always re-evaluates.
 *
 * Skipped in client mode: FirstRun is the server admin's responsibility on the
 * machine that owns the database, not on every workstation that connects.
 */
async function refreshSetupStatus() {
  if (connectionStore.isClientMode) return;
  refreshing.value = true;
  try {
    const status = await api.get('/setup/status');
    setupStatus.value = status || null;

    if (!status?.setupRequired) {
      isFirstRunDialog.value = false;
      return;
    }

    if (
      status.reason === 'NO_ADMIN_USER' ||
      status.reason === 'NO_COMPANY_SETTINGS'
    ) {
      isFirstRunDialog.value = true;
    } else {
      isFirstRunDialog.value = false;
    }
  } catch (err) {
    // Network / early-startup failures: clear local state and let the next
    // backend transition retry. Don't auto-open FirstRun — we cannot prove
    // the schema is ready.
    setupStatus.value = null;
    isFirstRunDialog.value = false;
    console.warn('[setup] /api/setup/status failed:', err?.message || err);
  } finally {
    refreshing.value = false;
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

async function handleCopyDiagnostics() {
  if (!setupStatus.value) return;
  copyingDiagnostics.value = true;
  try {
    const s = setupStatus.value;
    const payload = {
      reason: s.reason || null,
      databaseConnected: s.databaseConnected ?? null,
      schemaReady: s.schemaReady ?? null,
      missingTables: s.missingTables || [],
      migrations: {
        folderSelected: s.migrations?.folderSelected || null,
        errorMessage: s.migrations?.errorMessage || null,
      },
      serverMode: s.serverMode || null,
      timestamp: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API may be unavailable in some Electron sandboxes — fall
      // back to a hidden textarea so the user still gets the data.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    notification.success('تم نسخ معلومات التشخيص.');
  } catch (err) {
    notification.error(err?.message || 'تعذّر نسخ معلومات التشخيص.');
  } finally {
    copyingDiagnostics.value = false;
  }
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
    // The backend's errorHandler plugin returns a structured body when setup
    // is broken: { code: <REASON>, details: { reason, missingTables, ... } }.
    // Surface that as a setup-error dialog instead of just a toast so the
    // operator gets the same actionable diagnostics they'd see at /status.
    const reason = error?.code || error?.details?.reason;
    if (reason && SCHEMA_FAILURE_REASONS.has(reason)) {
      isFirstRunDialog.value = false;
      setupStatus.value = {
        databaseConnected: error?.details?.databaseConnected ?? true,
        schemaReady: false,
        setupRequired: true,
        reason,
        missingTables: error?.details?.missingTables || [],
        details: error?.details?.cause || error?.message || null,
        migrations: error?.details?.migrations || null,
        expectedDatabase: error?.details?.expectedDatabase || null,
        actualDatabase: error?.details?.actualDatabase || null,
        serverMode: error?.details?.serverMode || null,
      };
      return;
    }

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
.text-break {
  word-break: break-all;
}
</style>
