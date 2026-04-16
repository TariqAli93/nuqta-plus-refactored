<template>
  <v-card flat>
    <v-card-title class="text-h6 pa-4 pb-2">حالة الترخيص</v-card-title>

    <v-card-text>
      <!-- Loading -->
      <div v-if="loading" class="d-flex justify-center pa-8">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <!-- Error loading status -->
      <v-alert v-else-if="loadError" type="error" variant="tonal" class="mb-4">
        {{ loadError }}
      </v-alert>

      <template v-else>
        <!-- Status Banner -->
        <v-alert
          :type="status.valid ? 'success' : 'error'"
          variant="tonal"
          class="mb-4"
          :icon="status.valid ? 'mdi-shield-check' : 'mdi-shield-off'"
        >
          <div class="font-weight-bold">
            {{ status.valid ? 'الترخيص نشط' : 'الترخيص غير صالح أو منتهي' }}
          </div>
          <div v-if="!status.valid && status.error" class="text-body-2 mt-1">
            {{ translateError(status.error) }}
          </div>
        </v-alert>

        <!-- License Details -->
        <v-table v-if="status.valid && status.license" class="mb-4">
          <tbody>
            <tr>
              <td class="text-medium-emphasis font-weight-medium" style="width: 40%">
                نوع الترخيص
              </td>
              <td>
                <v-chip size="small" color="primary" variant="tonal">
                  {{ status.license.licenseType || '—' }}
                </v-chip>
              </td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">تاريخ الإصدار</td>
              <td>{{ formatDate(status.license.issuedAt) }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">تاريخ الانتهاء</td>
              <td>
                <span :class="isExpiringSoon ? 'text-warning' : ''">
                  {{ formatDate(status.license.expiry) }}
                </span>
                <v-chip
                  v-if="isExpiringSoon"
                  size="x-small"
                  color="warning"
                  variant="tonal"
                  class="ms-2"
                >
                  ينتهي قريباً
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>

        <!-- Machine ID -->
        <div class="text-subtitle-2 text-medium-emphasis mb-1">معرّف الجهاز</div>
        <v-text-field
          :model-value="status.machineId || '—'"
          readonly
          variant="outlined"
          density="compact"
          dir="ltr"
          class="mb-2"
        >
          <template #append-inner>
            <v-tooltip :text="copied ? 'تم النسخ!' : 'نسخ'" location="top">
              <template #activator="{ props }">
                <v-icon
                  v-bind="props"
                  :color="copied ? 'success' : 'default'"
                  style="cursor: pointer"
                  @click="copyMachineId"
                >
                  {{ copied ? 'mdi-check' : 'mdi-content-copy' }}
                </v-icon>
              </template>
            </v-tooltip>
          </template>
        </v-text-field>
      </template>
    </v-card-text>

    <v-card-actions class="pa-4 pt-0">
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="loadStatus"
      >
        تحديث
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const loading = ref(true);
const loadError = ref(null);
const copied = ref(false);

const status = ref({
  valid: false,
  error: null,
  license: null,
  machineId: null,
});

async function loadStatus() {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await window.licenseAPI.getStatus();
    if (!res.success && !res.valid) {
      // still render what we have (error message etc.)
    }
    status.value = res;

    console.log('License status loaded:', res);
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadStatus);

function formatDate(dateStr) {
  if (!dateStr) return '—';
  if (dateStr === 'never' || dateStr === 'lifetime') return 'مدى الحياة';
  try {
    return new Date(dateStr).toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      numberingSystem: 'latn',
    });
  } catch {
    return dateStr;
  }
}

const isExpiringSoon = computed(() => {
  if (!status.value.license?.expiry) return false;
  const expiry = new Date(status.value.license.expiry);
  const daysLeft = (expiry - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft > 0 && daysLeft <= 30;
});

async function copyMachineId() {
  if (!status.value.machineId) return;
  await navigator.clipboard.writeText(status.value.machineId);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

const ERROR_MAP = {
  'No license stored': 'لا يوجد ترخيص مخزّن',
  'License storage is corrupted': 'ملف الترخيص تالف',
  'License storage integrity check failed — file may be tampered':
    'فشل التحقق من سلامة الترخيص — قد يكون الملف معدّلاً',
  'License has expired': 'انتهت صلاحية الترخيص',
  'Machine ID mismatch': 'معرّف الجهاز غير متطابق',
  'Invalid signature': 'التوقيع غير صالح',
};

function translateError(err) {
  return ERROR_MAP[err] || err;
}
</script>
