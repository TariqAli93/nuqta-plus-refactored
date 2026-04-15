<template>
  <div class="activation-screen">
    <v-card width="500" rounded="xl" elevation="12" class="activation-card">
      <!-- Header -->
      <v-card-item class="pt-8 pb-2 text-center">
        <div class="text-h5 font-weight-bold text-primary mb-1">نقطة بلس</div>
        <div class="text-caption text-medium-emphasis">يرجى تفعيل التطبيق للمتابعة</div>
      </v-card-item>

      <v-divider class="mx-6 my-3" />

      <!-- Machine ID -->
      <div class="px-6 pb-1">
        <div class="text-caption text-medium-emphasis mb-1">معرّف الجهاز (Machine ID)</div>
        <div class="d-flex align-center gap-2">
          <v-text-field
            :model-value="machineId ?? 'جارٍ التحميل...'"
            readonly
            variant="outlined"
            density="compact"
            hide-details
            class="flex-grow-1 machine-id-field"
            style="direction: ltr; font-family: monospace; font-size: 12px"
          />
          <v-tooltip :text="copied ? 'تم النسخ!' : 'نسخ'" location="top">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
                :color="copied ? 'success' : 'default'"
                variant="tonal"
                size="small"
                :disabled="!machineId"
                @click="copyMachineId"
              />
            </template>
          </v-tooltip>
        </div>
      </div>

      <v-divider class="mx-6 my-3" />

      <v-card-text class="px-6 pb-7">
        <!-- Tabs -->
        <v-tabs v-model="activeTab" color="primary" class="mb-4 rounded-lg border" grow>
          <v-tab value="file">ملف الترخيص (.lic)</v-tab>
          <v-tab value="key">مفتاح Base64</v-tab>
        </v-tabs>

        <v-window v-model="activeTab">
          <!-- File tab -->
          <v-window-item value="file">
            <div class="d-flex align-center gap-2">
              <v-text-field
                :model-value="selectedFileName"
                placeholder="لم يتم اختيار ملف"
                readonly
                variant="outlined"
                hide-details
                class="flex-grow-1"
                style="direction: ltr"
              />
              <v-btn
                variant="tonal"
                color="primary"
                :loading="isBrowsing"
                min-width="110"
                @click="handleBrowseFile"
              >
                استعراض...
              </v-btn>
            </div>
          </v-window-item>

          <!-- Key tab -->
          <v-window-item value="key">
            <v-textarea
              v-model="licenseKey"
              placeholder="eyJtYWNoaW5lSWQiOiAi..."
              variant="outlined"
              hide-details
              :rows="4"
              no-resize
              class="key-textarea"
              style="direction: ltr; text-align: left"
            />
          </v-window-item>
        </v-window>

        <!-- Activate button -->
        <v-btn
          block
          color="primary"
          size="large"
          class="mt-5"
          :loading="isActivating"
          :disabled="isActivating"
          rounded="lg"
          @click="handleActivate"
        >
          تفعيل التطبيق
        </v-btn>

        <!-- Status alert -->
        <v-alert
          v-if="status.message"
          :type="status.type"
          variant="tonal"
          rounded="lg"
          density="compact"
          class="mt-4"
          closable
          @click:close="status.message = ''"
        >
          {{ status.message }}
        </v-alert>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const activeTab = ref('file');
const machineId = ref(null);
const copied = ref(false);

onMounted(async () => {
  if (!window.licenseAPI) return;
  try {
    const result = await window.licenseAPI.getMachineId();
    if (result.success) machineId.value = result.machineId;
  } catch {
    // silently ignore — machine ID display is informational only
  }
});

async function copyMachineId() {
  if (!machineId.value) return;
  try {
    await navigator.clipboard.writeText(machineId.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // fallback for environments without clipboard API
  }
}
const selectedFileName = ref('');
const selectedFilePath = ref(null);
const licenseKey = ref('');
const isBrowsing = ref(false);
const isActivating = ref(false);
const status = ref({ type: 'error', message: '' });

const ERROR_MAP = {
  'License format is invalid or corrupted': 'صيغة الترخيص غير صحيحة أو تالفة.',
  'Signature verification failed — license may be tampered':
    'فشل التحقق من التوقيع — قد يكون الترخيص مزوراً.',
  'License is bound to a different machine': 'هذا الترخيص مرتبط بجهاز آخر.',
  'License has expired': 'انتهت صلاحية الترخيص.',
  'System clock appears to have been rolled back': 'يبدو أن ساعة النظام تم التلاعب بها.',
  'License storage integrity check failed': 'فشل التحقق من سلامة ملف الترخيص.',
  'No license stored': 'لا يوجد ترخيص محفوظ.',
};

function translateError(error) {
  return ERROR_MAP[error] || error || 'فشل التفعيل.';
}

async function handleBrowseFile() {
  if (!window.licenseAPI) return;
  isBrowsing.value = true;
  status.value.message = '';
  try {
    const result = await window.licenseAPI.browseFile();
    if (!result.canceled && result.filePath) {
      selectedFilePath.value = result.filePath;
      selectedFileName.value = result.filePath.split(/[\\/]/).pop();
    }
  } catch (err) {
    status.value = { type: 'error', message: 'فشل في فتح مربع الحوار: ' + err.message };
  } finally {
    isBrowsing.value = false;
  }
}

async function handleActivate() {
  if (!window.licenseAPI) {
    status.value = { type: 'error', message: 'واجهة برمجة الترخيص غير متاحة.' };
    return;
  }

  status.value.message = '';

  let input;
  if (activeTab.value === 'file') {
    if (!selectedFilePath.value) {
      status.value = { type: 'warning', message: 'يرجى اختيار ملف الترخيص أولاً.' };
      return;
    }
    input = { type: 'file', path: selectedFilePath.value };
  } else {
    const key = licenseKey.value.trim();
    if (!key) {
      status.value = { type: 'warning', message: 'يرجى لصق مفتاح الترخيص.' };
      return;
    }
    input = { type: 'key', key };
  }

  isActivating.value = true;
  try {
    const result = await window.licenseAPI.activate(input);
    if (result.success) {
      status.value = { type: 'success', message: 'تم التفعيل بنجاح! جارٍ تشغيل التطبيق…' };
      // Main process will close this window and open the main app window
    } else {
      status.value = { type: 'error', message: translateError(result.error) };
      isActivating.value = false;
    }
  } catch (err) {
    status.value = { type: 'error', message: 'خطأ غير متوقع: ' + err.message };
    isActivating.value = false;
  }
}
</script>

<style scoped>
.activation-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(var(--v-theme-background));
}

.activation-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.activation-tabs {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  overflow: hidden;
}
</style>
