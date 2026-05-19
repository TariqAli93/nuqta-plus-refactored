<template>
  <v-card flat>
    <v-card-title class="text-h6 pa-4 pb-2 d-flex align-center">
      <v-icon class="me-2" color="primary">mdi-cloud-upload</v-icon>
      {{ labels.sectionTitle }}
    </v-card-title>

    <v-card-text>
      <p class="text-body-2 text-medium-emphasis mb-4">
        {{ labels.description }}
      </p>

      <!-- Loading-on-mount placeholder -->
      <div v-if="initialLoading" class="d-flex justify-center py-6">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else>
        <!-- Status row -->
        <div class="d-flex align-center mb-4">
          <span class="text-subtitle-2 me-3">الحالة:</span>
          <v-chip
            :color="store.statusColor"
            variant="tonal"
            size="default"
            :prepend-icon="store.enabled ? 'mdi-check-circle' : 'mdi-circle-off-outline'"
          >
            <template v-if="store.loading">
              <v-progress-circular
                indeterminate
                color="info"
                size="14"
                width="2"
                class="me-2"
              />
            </template>
            {{ store.statusLabel }}
          </v-chip>
        </div>

        <!-- Error alert -->
        <v-alert
          v-if="store.error"
          type="error"
          variant="tonal"
          closable
          class="mb-4"
          border="start"
          @click:close="store.clearError"
        >
          {{ store.error }}
        </v-alert>

        <!-- Binary-missing warning (preventative) -->
        <v-alert
          v-if="!store.cloudflaredAvailable && !store.error"
          type="warning"
          variant="tonal"
          class="mb-4"
        >
          {{ labels.binaryMissing }}
        </v-alert>

        <!-- Public URL display (only when enabled) -->
        <div v-if="store.enabled && store.publicUrl" class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">
            {{ labels.publicUrl }}
          </div>
          <v-text-field
            :model-value="store.publicUrl"
            readonly
            variant="outlined"
            density="compact"
            dir="ltr"
            hide-details
          >
            <template #append-inner>
              <v-tooltip :text="copied ? labels.copied : labels.copy" location="top">
                <template #activator="{ props }">
                  <v-icon
                    v-bind="props"
                    :color="copied ? 'success' : 'default'"
                    style="cursor: pointer"
                    @click="copyUrl"
                  >
                    {{ copied ? 'mdi-check' : 'mdi-content-copy' }}
                  </v-icon>
                </template>
              </v-tooltip>
            </template>
          </v-text-field>
        </div>

        <!-- Machine ID display (small, ltr) -->
        <div v-if="store.machineId" class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">معرّف الجهاز</div>
          <v-text-field
            :model-value="store.machineId"
            readonly
            variant="outlined"
            density="compact"
            dir="ltr"
            hide-details
          />
        </div>
      </template>
    </v-card-text>

    <v-card-actions class="pa-4 pt-0">
      <v-btn
        v-if="!store.enabled"
        color="primary"
        variant="flat"
        :loading="store.loading"
        :disabled="initialLoading || !store.cloudflaredAvailable"
        prepend-icon="mdi-cloud-upload"
        @click="handleEnable"
      >
        {{ labels.enable }}
      </v-btn>
      <v-btn
        v-else
        color="error"
        variant="tonal"
        :loading="store.loading"
        prepend-icon="mdi-cloud-off-outline"
        @click="handleDisable"
      >
        {{ labels.disable }}
      </v-btn>

      <v-spacer />

      <v-btn
        variant="text"
        prepend-icon="mdi-refresh"
        :disabled="store.loading || initialLoading"
        @click="refresh"
      >
        تحديث
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import {
  useRemoteAccessStore,
  REMOTE_ACCESS_LABELS as labels,
} from '@/stores/remoteAccess';

const store = useRemoteAccessStore();

const initialLoading = ref(true);
const copied = ref(false);

async function refresh() {
  try {
    await store.getRemoteAccessStatus();
  } catch {
    // error surfaced via store.error
  }
}

async function handleEnable() {
  try {
    await store.enableRemoteAccess();
  } catch {
    /* error surfaced via store.error */
  }
}

async function handleDisable() {
  try {
    await store.disableRemoteAccess();
  } catch {
    /* error surfaced via store.error */
  }
}

async function copyUrl() {
  if (!store.publicUrl) return;
  try {
    await navigator.clipboard.writeText(store.publicUrl);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // navigator.clipboard may fail in some Electron contexts
  }
}

onMounted(async () => {
  try {
    await store.getRemoteAccessStatus();
  } catch {
    /* surfaced via error alert */
  } finally {
    initialLoading.value = false;
  }
});
</script>
