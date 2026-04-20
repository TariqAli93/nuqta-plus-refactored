<template>
  <!-- Pass-through when backend is ready (normal case — window shown after splash) -->
  <!-- Also pass-through unconditionally on the Activation route (runs before backend starts) -->
  <slot v-if="shouldBypass || backendStore.status === 'ready'" />

  <!-- Loading overlay while backend is starting -->
  <v-overlay
    v-else-if="backendStore.status === 'starting'"
    :model-value="true"
    class="d-flex align-center justify-center"
    persistent
    scrim="surface"
  >
    <div class="text-center">
      <v-progress-circular indeterminate color="primary" size="56" class="mb-4" />
      <div class="text-body-1 text-medium-emphasis">جارٍ تشغيل الخادم المحلي…</div>
    </div>
  </v-overlay>

  <!-- Error screen when backend failed to start -->
  <v-container
    v-else-if="backendStore.status === 'error'"
    class="fill-height d-flex align-center justify-center"
  >
    <v-card max-width="480" class="pa-6 text-center" elevation="0" variant="outlined">
      <v-icon size="56" color="error" class="mb-4">mdi-alert-circle-outline</v-icon>
      <div class="text-h6 mb-2">تعذّر تشغيل الخادم</div>
      <div class="text-body-2 text-medium-emphasis mb-6">
        {{ backendStore.error || 'فشل تشغيل الخادم المحلي. تأكد من أن البرنامج مثبّت بشكل صحيح.' }}
      </div>
      <v-btn color="primary" variant="tonal" :loading="restarting" @click="handleRestart">
        إعادة المحاولة
      </v-btn>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useBackendStateStore } from '@/stores/backendState';
import { useConnectionStore } from '@/stores/connection';

const route = useRoute();
const backendStore = useBackendStateStore();
const connectionStore = useConnectionStore();
const restarting = ref(false);

/**
 * Bypass the backend gate when:
 * - On the Activation route (opens before backend starts)
 * - On the ServerSetup route (client mode, no local backend)
 * - In client mode (no local backend to wait for)
 */
const shouldBypass = computed(
  () =>
    route.name === 'Activation' ||
    route.name === 'ServerSetup' ||
    connectionStore.isClientMode
);

onMounted(() => {
  if (shouldBypass.value) return;
  backendStore.initialize();
});

async function handleRestart() {
  restarting.value = true;
  try {
    await backendStore.restart();
  } finally {
    restarting.value = false;
  }
}
</script>
