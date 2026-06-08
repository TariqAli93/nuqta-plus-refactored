<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '@/plugins/axios';
import { useSimpleLoading } from '@/composables/useLoading';
import { useNotificationStore } from '@/stores/notification';

const notification = useNotificationStore();
const { isLoading, startLoading, stopLoading } = useSimpleLoading();

// Long-running requests must not hit the default 10s axios timeout.
const LONG = { timeout: 0 };

// ── Group catalogue (loaded from the backend) ────────────────────────────────
const groups = ref([]); // [{ key, label, tables }]
const labelOf = (key) => groups.value.find((g) => g.key === key)?.label || key;

// ── Backup dialog state ──────────────────────────────────────────────────────
const backupDialog = ref(false);
const selected = ref([]); // selected group keys

const openBackup = () => {
  selected.value = groups.value.map((g) => g.key); // default: everything
  backupDialog.value = true;
};
const selectAll = () => (selected.value = groups.value.map((g) => g.key));
const clearAll = () => (selected.value = []);

const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI?.showSaveDialog;

/** Save text content to disk: native dialog under Electron, browser download otherwise. */
async function saveToFile(filename, content) {
  if (isElectron()) {
    const { canceled, filePath } = await window.electronAPI.showSaveDialog({
      title: 'حفظ النسخة الاحتياطية',
      defaultPath: filename,
      filters: [{ name: 'NuqtaPlus Backup', extensions: ['nqbackup'] }],
    });
    if (canceled || !filePath) return false;
    await window.electronAPI.saveFile(filePath, content);
    return true;
  }
  // Browser fallback
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

const createBackup = async () => {
  if (selected.value.length === 0) {
    notification.error('اختر مجموعة واحدة على الأقل');
    return;
  }
  startLoading();
  try {
    const res = await api.post('/backup/create', { groups: selected.value }, LONG);
    const { filename, content } = res.data;
    const saved = await saveToFile(filename, content);
    if (saved) {
      notification.success('تم إنشاء النسخة الاحتياطية بنجاح');
      backupDialog.value = false;
    }
  } catch (e) {
    notification.error('فشل إنشاء النسخة الاحتياطية: ' + (e.response?.data?.message || e.message));
  } finally {
    stopLoading();
  }
};

// ── Restore dialog state ─────────────────────────────────────────────────────
const restoreDialog = ref(false);
const fileContent = ref(''); // encoded .nqbackup text
const fileName = ref('');
const manifest = ref(null);
const restoreSelected = ref([]); // group keys to restore
const understand = ref(false);
const safetyBackup = ref(true);
const summary = ref(null);
const fileInput = ref(null); // hidden <input> for browser fallback

const includedGroups = computed(() => manifest.value?.selectedGroups || []);

const resetRestore = () => {
  fileContent.value = '';
  fileName.value = '';
  manifest.value = null;
  restoreSelected.value = [];
  understand.value = false;
  summary.value = null;
};

const openRestore = () => {
  resetRestore();
  restoreDialog.value = true;
};

/** Read a backup file's text: native dialog under Electron, file input otherwise. */
async function pickFile() {
  if (isElectron()) {
    const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
      title: 'اختر ملف النسخة الاحتياطية',
      properties: ['openFile'],
      filters: [{ name: 'NuqtaPlus Backup', extensions: ['nqbackup'] }],
    });
    if (canceled || !filePaths?.length) return;
    const bytes = await window.electronAPI.readFile(filePaths[0]);
    const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    fileName.value = filePaths[0].split(/[\\/]/).pop();
    await loadManifest(text);
  } else {
    fileInput.value?.click();
  }
}

const onBrowserFile = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  const text = await file.text();
  await loadManifest(text);
  e.target.value = '';
};

async function loadManifest(text) {
  startLoading();
  try {
    const res = await api.post('/backup/preview', { content: text }, LONG);
    fileContent.value = text;
    manifest.value = res.data;
    restoreSelected.value = [...(res.data.selectedGroups || [])];
  } catch (e) {
    resetRestore();
    notification.error('ملف غير صالح: ' + (e.response?.data?.message || e.message));
  } finally {
    stopLoading();
  }
}

const restore = async () => {
  if (!understand.value) return;
  if (restoreSelected.value.length === 0) {
    notification.error('اختر مجموعة واحدة على الأقل للاستعادة');
    return;
  }
  startLoading();
  try {
    // Optional safety backup of the SAME groups currently in the database.
    if (safetyBackup.value) {
      try {
        const safe = await api.post('/backup/create', { groups: restoreSelected.value }, LONG);
        await saveToFile('safety-' + safe.data.filename, safe.data.content);
      } catch {
        notification.info('تعذر إنشاء نسخة الأمان — يمكن المتابعة يدويًا');
      }
    }

    const res = await api.post(
      '/backup/restore',
      { content: fileContent.value, groups: restoreSelected.value, mode: 'replace' },
      LONG
    );
    summary.value = res.data;
    notification.success('تمت الاستعادة بنجاح');
  } catch (e) {
    notification.error('فشل الاستعادة: ' + (e.response?.data?.message || e.message));
  } finally {
    stopLoading();
  }
};

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ar');
  } catch {
    return iso;
  }
};

onMounted(async () => {
  try {
    const res = await api.get('/backup/groups');
    groups.value = res.data;
  } catch {
    // Non-fatal: the buttons still work but with empty checkbox lists.
  }
});
</script>

<template>
  <v-card elevation="0">
    <v-card-title class="d-flex align-center justify-space-between flex-wrap">
      <div class="text-h6 font-weight-bold">🗂️ النسخ الاحتياطي الانتقائي (تصدير/استيراد البيانات)</div>
      <div class="d-flex gap-2">
        <v-btn color="primary" variant="elevated" prepend-icon="mdi-export-variant" @click="openBackup">
          إنشاء نسخة احتياطية
        </v-btn>
        <v-btn color="secondary" variant="elevated" prepend-icon="mdi-import" @click="openRestore">
          استعادة من ملف
        </v-btn>
      </div>
    </v-card-title>

    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable">
        اختر مجموعات البيانات التي تريد تصديرها إلى ملف
        <code>.nqbackup</code> مشفّر، أو استورد ملفًا لاستعادة بيانات محددة.
      </v-alert>
    </v-card-text>

    <!-- ── Backup dialog ────────────────────────────────────────────────── -->
    <v-dialog v-model="backupDialog" max-width="640" persistent scrollable>
      <v-card>
        <v-card-title class="text-h6">إنشاء نسخة احتياطية</v-card-title>
        <v-divider />
        <v-card-text style="max-height: 60vh">
          <div class="d-flex gap-2 mb-3">
            <v-btn size="small" variant="tonal" @click="selectAll">تحديد الكل</v-btn>
            <v-btn size="small" variant="tonal" @click="clearAll">إلغاء التحديد</v-btn>
          </div>
          <v-row dense>
            <v-col v-for="g in groups" :key="g.key" cols="12" sm="6">
              <v-checkbox
                v-model="selected"
                :value="g.key"
                :label="g.label"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="isLoading" @click="backupDialog = false">إلغاء</v-btn>
          <v-btn color="primary" variant="elevated" :loading="isLoading" @click="createBackup">
            إنشاء النسخة
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── Restore dialog ───────────────────────────────────────────────── -->
    <v-dialog v-model="restoreDialog" max-width="720" persistent scrollable>
      <v-card>
        <v-card-title class="text-h6">استعادة نسخة احتياطية</v-card-title>
        <v-divider />
        <v-card-text style="max-height: 70vh">
          <!-- hidden input for non-Electron environments -->
          <input
            ref="fileInput"
            type="file"
            accept=".nqbackup"
            class="d-none"
            @change="onBrowserFile"
          />

          <div class="d-flex align-center gap-3 mb-4">
            <v-btn variant="tonal" prepend-icon="mdi-file-upload-outline" @click="pickFile">
              اختيار ملف النسخة
            </v-btn>
            <span v-if="fileName" class="text-medium-emphasis">{{ fileName }}</span>
          </div>

          <!-- Manifest preview -->
          <template v-if="manifest">
            <v-table density="compact" class="mb-4">
              <tbody>
                <tr><td>تاريخ الإنشاء</td><td>{{ fmtDate(manifest.createdAt) }}</td></tr>
                <tr><td>إصدار التطبيق</td><td>{{ manifest.appVersion }}</td></tr>
                <tr><td>إصدار النسخة</td><td>{{ manifest.backupVersion }}</td></tr>
              </tbody>
            </v-table>

            <div class="text-subtitle-2 mb-2">المجموعات المضمّنة — اختر ما تريد استعادته:</div>
            <v-row dense>
              <v-col v-for="key in includedGroups" :key="key" cols="12" sm="6">
                <v-checkbox
                  v-model="restoreSelected"
                  :value="key"
                  density="compact"
                  hide-details
                >
                  <template #label>
                    {{ labelOf(key) }}
                    <v-chip size="x-small" class="ms-2" variant="tonal">
                      {{ manifest.counts?.[key] ?? 0 }}
                    </v-chip>
                  </template>
                </v-checkbox>
              </v-col>
            </v-row>

            <v-alert type="warning" variant="tonal" class="mt-4" density="comfortable">
              ستؤدي الاستعادة إلى <strong>استبدال</strong> البيانات المحددة. لا يمكن التراجع عن هذا
              الإجراء إلا إذا أنشأت نسخة احتياطية أولًا.
            </v-alert>

            <v-checkbox
              v-model="safetyBackup"
              density="compact"
              hide-details
              label="إنشاء نسخة أمان من البيانات الحالية قبل الاستعادة"
              class="mt-2"
            />
            <v-checkbox
              v-model="understand"
              density="compact"
              hide-details
              color="error"
              label="أفهم أن هذا سيستبدل البيانات المحددة"
            />

            <!-- Summary after restore -->
            <v-alert v-if="summary" type="success" variant="tonal" class="mt-4" density="comfortable">
              <div class="font-weight-bold mb-1">اكتملت الاستعادة</div>
              <div>المجموعات المستعادة: {{ summary.restoredGroups.map(labelOf).join('، ') }}</div>
              <div v-if="summary.skippedGroups?.length">
                المتخطّاة: {{ summary.skippedGroups.map(labelOf).join('، ') }}
              </div>
              <div class="mt-1">
                الصفوف:
                <span v-for="(c, k) in summary.counts" :key="k" class="me-2">{{ labelOf(k) }}={{ c }}</span>
              </div>
            </v-alert>
          </template>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="isLoading" @click="restoreDialog = false">إغلاق</v-btn>
          <v-btn
            color="error"
            variant="elevated"
            :loading="isLoading"
            :disabled="!manifest || !understand"
            @click="restore"
          >
            استعادة
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
.gap-3 {
  gap: 12px;
}
</style>
