<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '@/plugins/axios';
import { useRouter } from 'vue-router';
import { useSimpleLoading } from '@/composables/useLoading';
import { useNotificationStore } from '@/stores/notification';
import { useResetStore } from '@/stores/reset';
import { useAuthStore } from '@/stores/auth';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useTheme } from 'vuetify';

const router = useRouter();
const notification = useNotificationStore();

const resetStore = useResetStore();
const authStore = useAuthStore();

const theme = useTheme();

const backups = ref([]);
const { isLoading, startLoading, stopLoading } = useSimpleLoading();

// Dialog state
const restoreDialog = ref(false);
const clearDbDialog = ref(false);
const importDialog = ref(false);
const selectedBackup = ref(null);

const isDarkMode = computed(() => theme.global.current.value.dark);

const createBackup = async () => {
  startLoading();
  try {
    await api.post('/settings/backups', {});
    notification.success('تم إنشاء النسخة الاحتياطية بنجاح');
    await load();
  } catch {
    notification.error('فشل في إنشاء النسخة الاحتياطية');
  } finally {
    stopLoading();
  }
};

const load = async () => {
  startLoading();
  try {
    const response = await api.get('/settings/backups');
    backups.value = response.data;
  } catch {
    notification.error('فشل في تحميل قائمة النسخ الاحتياطية');
  } finally {
    stopLoading();
  }
};

const deleteBackup = async (filename) => {
  startLoading();
  try {
    await api.delete(`/settings/backups/${filename}`);
    notification.success('تم حذف النسخة الاحتياطية بنجاح');
    await load();
  } catch {
    notification.error('فشل في حذف النسخة الاحتياطية');
  } finally {
    stopLoading();
  }
};

const restoreBackup = async (filename) => {
  selectedBackup.value = filename;
  restoreDialog.value = true;
};

const confirmRestore = async () => {
  startLoading();
  try {
    const response = await window.electronAPI.restoreBackup(selectedBackup.value);
    if (response.ok) {
      notification.success('تم استعادة النسخة الاحتياطية بنجاح');
      // إعادة تحميل التطبيق بعد الاستعادة
      setTimeout(() => {
        window.location.reload();
        router.push('/');
      }, 2000);
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    notification.error('فشل في استعادة النسخة الاحتياطية: ' + error.message);
  } finally {
    stopLoading();
    selectedBackup.value = null;
  }
};

const exportBackup = async (filename) => {
  try {
    const response = await window.electronAPI.exportBackup(filename);
    if (response.ok) {
      notification.success('تم تصدير النسخة الاحتياطية بنجاح');
    } else if (response.reason !== 'canceled') {
      throw new Error(response.error);
    }
  } catch (error) {
    notification.error('فشل في تصدير النسخة الاحتياطية: ' + error.message);
  }
};

const importBackup = () => {
  importDialog.value = true;
};

const confirmImport = async () => {
  startLoading();
  try {
    const response = await window.electronAPI.importBackup();
    if (response.ok) {
      notification.success('تم استيراد النسخة الاحتياطية بنجاح');
      notification.info('جارٍ إعادة تحميل التطبيق...');
      // إعادة تحميل التطبيق بعد الاستيراد
      setTimeout(() => {
        window.location.reload();
        router.push('/');
      }, 2000);
    } else if (response.reason !== 'canceled') {
      throw new Error(response.error);
    }
  } catch (error) {
    notification.error('فشل في استيراد النسخة الاحتياطية: ' + error.message);
  } finally {
    stopLoading();
  }
};

const clearDatabase = async () => {
  clearDbDialog.value = true;
};

const confirmClearDatabase = async () => {
  startLoading();
  try {
    const response = await resetStore.resetDatabase();
    console.log(response);
    if (response?.success) {
      notification.success('تم تصفير قاعدة البيانات بنجاح');
      startLoading();
      notification.info('جارٍ إعادة تحميل التطبيق...');
      // إعادة تحميل التطبيق بعد التصفير
      setTimeout(() => {
        authStore.logout();
        authStore.resetAuth();

        window.location.reload();
        router.push('/');
      }, 2000);
    } else {
      throw new Error('فشل في تصفير قاعدة البيانات');
    }
  } catch (error) {
    notification.error('فشل في تصفير قاعدة البيانات: ' + error.message);
  } finally {
    stopLoading();
  }
};

const toYmd = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const headers = [
  { title: 'اسم الملف', value: 'filename' },
  { title: 'الحجم', value: 'sizeReadable' },
  { title: 'تاريخ الإنشاء', value: 'createdAt' },
  { title: 'الإجراء', value: 'actions', sortable: false },
];

onMounted(async () => {
  await load();
});
</script>

<template>
  <v-card elevation="0">
    <v-card-title class="d-flex align-center justify-space-between">
      <div class="text-h6 font-weight-bold">📦 إدارة نسخ قاعدة البيانات الاحتياطية</div>
      <div class="flex gap-2">
        <v-btn
          color="primary"
          variant="elevated"
          prepend-icon="mdi-database-export-outline"
          @click="createBackup"
        >
          إنشاء نسخة احتياطية
        </v-btn>

        <v-btn
          color="secondary"
          variant="elevated"
          prepend-icon="mdi-database-import-outline"
          @click="importBackup"
        >
          استيراد نسخة احتياطية
        </v-btn>

        <v-btn
          color="error"
          variant="elevated"
          prepend-icon="mdi-database-remove-outline"
          @click="clearDatabase"
        >
          تصفير قاعدة البيانات
        </v-btn>
      </div>
    </v-card-title>

    <v-divider class="my-3"></v-divider>

    <v-card-text>
      <v-skeleton-loader v-if="isLoading" type="table" class="mx-auto" />

      <v-alert v-else-if="backups.length === 0" type="info" variant="tonal" class="text-center">
        لا توجد نسخ احتياطية حتى الآن.
      </v-alert>

      <v-data-table v-else :headers="headers" :items="backups">
        <template #[`item.createdAt`]="{ item }">
          {{ toYmd(item.createdAt) }}
        </template>

        <template #[`item.actions`]="{ item }">
          <v-btn icon small color="error" variant="text" @click="deleteBackup(item.filename)">
            <v-icon>mdi-delete</v-icon>
            <v-tooltip activator="parent" location="start" :theme="isDarkMode ? 'light' : 'dark'">
              حذف النسخة الاحتياطية
            </v-tooltip>
          </v-btn>

          <v-btn icon small color="error" variant="text" @click="restoreBackup(item.filename)">
            <v-icon>mdi-restore</v-icon>
            <v-tooltip activator="parent" location="start" :theme="isDarkMode ? 'light' : 'dark'">
              استعادة النسخة الاحتياطية
            </v-tooltip>
          </v-btn>

          <v-btn icon small color="primary" variant="text" @click="exportBackup(item.filename)">
            <v-icon>mdi-export</v-icon>
            <v-tooltip activator="parent" location="start" :theme="isDarkMode ? 'light' : 'dark'">
              تصدير النسخة الاحتياطية
            </v-tooltip>
          </v-btn>
        </template>
      </v-data-table>
    </v-card-text>

    <v-divider class="my-3"></v-divider>

    <v-card-actions>
      <v-btn variant="outlined" prepend-icon="mdi-refresh" color="primary" @click="load">
        تحديث القائمة
      </v-btn>
    </v-card-actions>

    <!-- Restore Confirmation Dialog -->
    <ConfirmDialog
      v-model="restoreDialog"
      title="استعادة النسخة"
      message="هل أنت متأكد من استعادة هذه النسخة؟ سيتم فقدان أي بيانات تم إدخالها بعد تاريخ النسخة."
      type="warning"
      confirm-text="استعادة"
      cancel-text="إلغاء"
      @confirm="confirmRestore"
    />

    <!-- Import Confirmation Dialog -->
    <ConfirmDialog
      v-model="importDialog"
      title="استيراد نسخة احتياطية"
      message="هل أنت متأكد من استيراد نسخة احتياطية؟ سيتم استبدال قاعدة البيانات الحالية بالنسخة المستوردة وفقدان جميع البيانات الحالية."
      type="warning"
      confirm-text="استيراد"
      cancel-text="إلغاء"
      @confirm="confirmImport"
    />

    <!-- Clear Database Confirmation Dialog -->
    <ConfirmDialog
      v-model="clearDbDialog"
      title="تصفير قاعدة البيانات"
      message="هل أنت متأكد من تصفير قاعدة البيانات؟ سيتم فقدان جميع البيانات الحالية ولا يمكن التراجع عن هذه العملية."
      type="error"
      confirm-text="تصفير"
      cancel-text="إلغاء"
      persistent
      @confirm="confirmClearDatabase"
    />
  </v-card>
</template>

<style scoped></style>
