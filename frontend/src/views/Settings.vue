<template>
  <div>
    <!-- Error Alert -->
    <v-alert
      v-if="settingsStore.error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="settingsStore.clearError"
    >
      {{ settingsStore.error }}
    </v-alert>
    <!-- Header -->

    <v-row>
      <v-col cols="12" md="2">
        <v-card class="flex flex-col">
          <div class="flex justify-space-between items-center pa-3">
            <div class="text-h6 font-semibold text-primary">الاعدادات</div>
          </div>

          <v-tabs v-model="activeTab" class="pa-3" direction="vertical" spaced="both" hide-slider>
            <v-tab value="company">
              <v-icon start>mdi-domain</v-icon>
              <span> معلومات الشركة</span>
            </v-tab>
            <v-tab value="currency">
              <v-icon start>mdi-currency-usd</v-icon>
              <span>إعدادات العملة</span>
            </v-tab>
            <v-tab value="connection">
              <v-icon start>mdi-server-network</v-icon>
              <span>الاتصال</span>
            </v-tab>
            <v-tab value="backup">
              <v-icon start>mdi-backup-restore</v-icon>
              <span>إدارة النسخ الاحتياطي</span>
            </v-tab>
            <v-tab value="license">
              <v-icon start>mdi-license</v-icon>
              <span>الترخيص</span>
            </v-tab>
          </v-tabs>
        </v-card>
      </v-col>

      <v-col cols="12" md="10">
        <v-window v-model="activeTab">
          <!-- Company Information Tab -->
          <v-window-item value="company" class="pa-0">
            <CompanyInfoForm />
          </v-window-item>

          <!-- Currency Settings Tab -->
          <v-window-item value="currency" class="pa-0">
            <CurrencySettings />
          </v-window-item>

          <!-- Connection Tab -->
          <v-window-item value="connection" class="pa-0">
            <ConnectionSettings v-if="connectionStore.isClientMode" />
            <ServerConnectionInfo v-else />
          </v-window-item>

          <v-window-item value="backup" class="pa-0">
            <BackupManager />
          </v-window-item>

          <v-window-item value="license" class="pa-0">
            <LicenseStatus />
          </v-window-item>
        </v-window>
      </v-col>
    </v-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useConnectionStore } from '@/stores/connection';
import { useRoute } from 'vue-router';
import CompanyInfoForm from '@/components/settings/CompanyInfoForm.vue';
import BackupManager from '@/components/settings/BackupManager.vue';
import CurrencySettings from '@/components/settings/CurrencySettings.vue';
import LicenseStatus from '@/components/settings/LicenseStatus.vue';
import ConnectionSettings from '@/components/settings/ConnectionSettings.vue';
import ServerConnectionInfo from '@/components/settings/ServerConnectionInfo.vue';

// Stores
const settingsStore = useSettingsStore();
const connectionStore = useConnectionStore();
const route = useRoute();
// State
const activeTab = ref('company');

onMounted(async () => {
  // Check for tab query parameter
  if (route.query.tab) {
    activeTab.value = route.query.tab;
  }

  try {
    await settingsStore.initialize();
    await settingsStore.fetchCurrencySettings();
  } catch {
    // Errors are surfaced via notification/error state in the store
  }
});
</script>
