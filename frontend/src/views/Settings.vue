<template>
  <div class="page-shell">
    <!-- Error Alert -->
    <v-alert
      v-if="settingsStore.error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      border="start"
      @click:close="settingsStore.clearError"
    >
      {{ settingsStore.error }}
    </v-alert>

    <PageHeader
      title="الإعدادات"
      subtitle="إدارة معلومات الشركة، العملات، الاتصال، النسخ الاحتياطي والترخيص"
      icon="mdi-cog"
    />

    <v-row>
      <v-col cols="12" md="3" lg="3">
        <v-card class="settings-tabs-card">
          <v-tabs
            v-model="activeTab"
            class="settings-tabs"
            direction="vertical"
            color="primary"
            density="comfortable"
          >
            <v-tab value="company">
              <v-icon start>mdi-domain</v-icon>
              <span>معلومات الشركة</span>
            </v-tab>
            <v-tab value="currency">
              <v-icon start>mdi-currency-usd</v-icon>
              <span>إعدادات العملة</span>
            </v-tab>
            <v-tab value="connection">
              <v-icon start>mdi-server-network</v-icon>
              <span>الاتصال</span>
            </v-tab>
            <v-tab v-if="canManageMessaging" value="messaging">
              <v-icon start>mdi-message-text</v-icon>
              <span>الرسائل والإشعارات</span>
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

      <v-col cols="12" md="9" lg="9">
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

          <v-window-item v-if="canManageMessaging" value="messaging" class="pa-0">
            <MessagingSettings />
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
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useConnectionStore } from '@/stores/connection';
import { useAuthStore } from '@/stores/auth';
import { useRoute } from 'vue-router';
import CompanyInfoForm from '@/components/settings/CompanyInfoForm.vue';
import BackupManager from '@/components/settings/BackupManager.vue';
import CurrencySettings from '@/components/settings/CurrencySettings.vue';
import LicenseStatus from '@/components/settings/LicenseStatus.vue';
import ConnectionSettings from '@/components/settings/ConnectionSettings.vue';
import ServerConnectionInfo from '@/components/settings/ServerConnectionInfo.vue';
import MessagingSettings from '@/components/settings/MessagingSettings.vue';
import PageHeader from '@/components/PageHeader.vue';

// Stores
const settingsStore = useSettingsStore();
const connectionStore = useConnectionStore();
const authStore = useAuthStore();
const route = useRoute();
// State
const activeTab = ref('company');

const canManageMessaging = computed(() => {
  const role = authStore.user?.role;
  return role === 'admin' || role === 'global_admin';
});

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

<style scoped lang="scss">
.settings-tabs-card {
  position: sticky;
  top: 1rem;
  padding: 0.5rem;
}

.settings-tabs {
  // tabs base
  :deep(.v-tab) {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    height: 44px;
    padding-inline: 0.85rem;
    margin-block: 2px;
    border-radius: 8px;
    font-weight: 500;
  }

  // selected state
  :deep(.v-tab--selected) {
    background-color: rgba(var(--v-theme-primary), 0.08);
  }

  // icon spacing
  :deep(.v-tab .v-icon) {
    margin-inline-end: 0.5rem;
  }
}

@media (max-width: 960px) {
  .settings-tabs-card {
    position: static;
    padding: 0.25rem;
    margin-bottom: 1rem;
  }

  .settings-tabs {
    :deep(.v-slide-group__container) {
      overflow-x: auto;
      scrollbar-width: none; // Firefox
    }

    :deep(.v-slide-group__container::-webkit-scrollbar) {
      display: none; // Chrome
    }
  }
}
</style>
