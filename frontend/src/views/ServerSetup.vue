<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card max-width="640" width="100%" class="pa-6" elevation="4" rounded="xl">
      <v-card-title class="text-center pb-2">
        <v-icon size="48" color="primary" class="mb-2">mdi-server-network</v-icon>
        <div class="text-h5">الاتصال بالخادم</div>
        <div class="text-body-2 text-medium-emphasis mt-1">
          سيتم البحث عن خوادم Nuqta Plus على الشبكة المحلية
        </div>
      </v-card-title>

      <v-card-text class="pt-4">
        <!-- Discovery in progress -->
        <div v-if="discovering" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" size="48" class="mb-3" />
          <div class="text-body-1">جاري البحث عن السيرفرات...</div>
        </div>

        <!-- Single server auto-connect (transient state) -->
        <v-alert
          v-else-if="autoConnectMessage"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          {{ autoConnectMessage }}
        </v-alert>

        <!-- Server selection list (multiple discovered) -->
        <div v-if="!discovering && discoveredServers.length > 1">
          <div class="text-subtitle-1 mb-3">اختر السيرفر</div>

          <v-list lines="three" rounded class="mb-4 border">
            <v-list-item
              v-for="server in discoveredServers"
              :key="server.id"
              :title="`${server.companyName} - ${server.branchName}`"
              :subtitle="serverSubtitle(server)"
              :active="selectedServerId === server.id"
              color="primary"
              @click="selectedServerId = server.id"
            >
              <template #prepend>
                <v-icon size="32" color="primary">mdi-server</v-icon>
              </template>
              <template #append>
                <v-chip v-if="server.version" size="small" variant="tonal">
                  v{{ server.version }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>

          <v-btn
            color="primary"
            block
            size="large"
            :disabled="!selectedServerId"
            :loading="connecting"
            @click="handleConnectSelected"
          >
            <v-icon start>mdi-connection</v-icon>
            اتصال بالسيرفر المختار
          </v-btn>

          <v-btn
            class="mt-2"
            variant="text"
            color="secondary"
            block
            size="small"
            :disabled="connecting"
            @click="handleRescan"
          >
            <v-icon start>mdi-refresh</v-icon>
            بحث مرة أخرى
          </v-btn>
        </div>

        <!-- Manual + remote entry (no servers found or user opted into manual) -->
        <div v-else-if="!discovering && (discoveredServers.length === 0 || manualMode)">
          <v-alert
            v-if="!manualMode && triedDiscovery"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            لم يتم العثور على سيرفر داخل الشبكة
          </v-alert>

          <v-tabs v-model="entryTab" density="compact" class="mb-4" grow>
            <v-tab value="local">
              <v-icon start>mdi-ip-network</v-icon>
              إدخال IP يدويًا
            </v-tab>
            <v-tab value="remote">
              <v-icon start>mdi-cloud-outline</v-icon>
              استخدام الرابط الخارجي
            </v-tab>
          </v-tabs>

          <v-window v-model="entryTab">
            <!-- Manual local IP -->
            <v-window-item value="local">
              <v-form ref="localFormRef" @submit.prevent="handleConnectManual">
                <v-text-field
                  v-model="host"
                  label="الرابط المحلي (IP)"
                  placeholder="192.168.1.100"
                  variant="outlined"
                  density="comfortable"
                  dir="ltr"
                  :rules="[rules.required, rules.validHost]"
                  prepend-inner-icon="mdi-ip-network"
                  class="mb-2"
                />

                <v-text-field
                  v-model.number="port"
                  label="المنفذ"
                  placeholder="41732"
                  variant="outlined"
                  density="comfortable"
                  dir="ltr"
                  type="number"
                  :rules="[rules.required, rules.validPort]"
                  prepend-inner-icon="mdi-ethernet"
                  class="mb-2"
                />

                <v-alert
                  v-if="connectionResult && !connectionResult.success"
                  type="error"
                  variant="tonal"
                  density="compact"
                  class="mb-4"
                >
                  {{ connectionResult.error }}
                </v-alert>

                <v-alert
                  v-else-if="connectionResult && connectionResult.success"
                  type="success"
                  variant="tonal"
                  density="compact"
                  class="mb-4"
                >
                  <div>متصل</div>
                  <div v-if="connectionResult.info" class="text-caption mt-1">
                    {{ connectionResult.info.name || connectionResult.info.service }}
                    <span v-if="connectionResult.info.version"> - v{{ connectionResult.info.version }}</span>
                  </div>
                </v-alert>

                <v-btn
                  type="submit"
                  color="primary"
                  block
                  size="large"
                  :loading="connecting"
                  :disabled="!host"
                >
                  <v-icon start>mdi-connection</v-icon>
                  اتصال
                </v-btn>
              </v-form>
            </v-window-item>

            <!-- Remote URL fallback -->
            <v-window-item value="remote">
              <v-form ref="remoteFormRef" @submit.prevent="handleConnectRemote">
                <v-text-field
                  v-model="remoteUrl"
                  label="الرابط الخارجي"
                  placeholder="https://shop-xxxx.codelapps.com"
                  variant="outlined"
                  density="comfortable"
                  dir="ltr"
                  :rules="[rules.required, rules.validRemoteUrl]"
                  prepend-inner-icon="mdi-cloud-outline"
                  class="mb-2"
                />

                <v-alert
                  v-if="connectionResult && !connectionResult.success"
                  type="error"
                  variant="tonal"
                  density="compact"
                  class="mb-4"
                >
                  {{ connectionResult.error }}
                </v-alert>

                <v-alert
                  v-else-if="connectionResult && connectionResult.success"
                  type="success"
                  variant="tonal"
                  density="compact"
                  class="mb-4"
                >
                  متصل
                </v-alert>

                <v-btn
                  type="submit"
                  color="primary"
                  block
                  size="large"
                  :loading="connecting"
                  :disabled="!remoteUrl"
                >
                  <v-icon start>mdi-cloud-check-outline</v-icon>
                  استخدام الرابط الخارجي
                </v-btn>
              </v-form>
            </v-window-item>
          </v-window>

          <!-- Discovered remote URLs (offered as quick choices) -->
          <div v-if="advertisedRemoteUrls.length > 0 && entryTab === 'remote'" class="mt-4">
            <div class="text-caption text-medium-emphasis mb-2">
              روابط خارجية متاحة من السيرفرات المكتشفة:
            </div>
            <v-chip
              v-for="urlOption in advertisedRemoteUrls"
              :key="urlOption"
              size="small"
              variant="tonal"
              color="primary"
              class="me-1 mb-1"
              @click="remoteUrl = urlOption"
            >
              {{ urlOption }}
            </v-chip>
          </div>

          <v-divider class="my-4" />

          <div class="d-flex flex-wrap ga-2 justify-center">
            <v-btn variant="text" color="secondary" size="small" @click="handleRescan">
              <v-icon start>mdi-refresh</v-icon>
              بحث مرة أخرى
            </v-btn>
            <v-btn
              v-if="hasSavedConnection"
              variant="text"
              color="secondary"
              size="small"
              @click="useSaved"
            >
              <v-icon start>mdi-history</v-icon>
              استخدام الاتصال المحفوظ
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useConnectionStore } from '@/stores/connection';
import {
  resolveConnection,
  connectToDiscoveredServer,
  connectViaRemoteUrl,
} from '@/services/connectionResolver.service.js';
import { discoverServers } from '@/services/serverDiscovery.service.js';

const router = useRouter();
const connectionStore = useConnectionStore();
const localFormRef = ref(null);
const remoteFormRef = ref(null);

const host = ref(connectionStore.serverHost || '');
const port = ref(connectionStore.serverPort || 41732);
const remoteUrl = ref(connectionStore.overrideUrl || '');
const entryTab = ref('local');

const discovering = ref(false);
const triedDiscovery = ref(false);
const connecting = ref(false);
const manualMode = ref(false);
const autoConnectMessage = ref('');

const discoveredServers = ref([]);
const selectedServerId = ref(null);
const connectionResult = ref(null);
const hasSavedConnection = ref(false);

const advertisedRemoteUrls = computed(() => {
  const urls = new Set();
  for (const s of discoveredServers.value) {
    if (s.remoteUrl) urls.add(s.remoteUrl);
  }
  return Array.from(urls);
});

function serverSubtitle(server) {
  const parts = [];
  if (server.ip) parts.push(`${server.ip}:${server.port}`);
  else if (server.host) parts.push(`${server.host}:${server.port}`);
  if (server.remoteUrl) parts.push(server.remoteUrl);
  return parts.join('  ·  ');
}

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
  validHost: (v) => {
    if (!v) return true;
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostnamePattern =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    return ipPattern.test(v) || hostnamePattern.test(v) || 'عنوان IP أو اسم مضيف غير صالح';
  },
  validPort: (v) => {
    const n = Number(v);
    return (n >= 1 && n <= 65535) || 'المنفذ يجب أن يكون بين 1 و 65535';
  },
  validRemoteUrl: (v) => {
    if (!v) return true;
    if (!/^https?:\/\//i.test(v)) return 'الرابط يجب أن يبدأ بـ http:// أو https://';
    try {
      // eslint-disable-next-line no-new
      new URL(v);
      return true;
    } catch {
      return 'صيغة الرابط غير صحيحة';
    }
  },
};

onMounted(async () => {
  hasSavedConnection.value = !!(connectionStore.serverHost || connectionStore.overrideUrl);
  await runAutoFlow();
});

async function runAutoFlow() {
  discovering.value = true;
  connectionResult.value = null;
  autoConnectMessage.value = '';
  triedDiscovery.value = false;
  discoveredServers.value = [];
  selectedServerId.value = null;

  try {
    const resolution = await resolveConnection({ durationMs: 4000 });
    triedDiscovery.value = true;

    if (resolution.kind === 'saved' && resolution.connected) {
      autoConnectMessage.value = 'تم استرجاع الاتصال المحفوظ. متصل';
      setTimeout(() => router.replace({ name: 'Login' }), 300);
      return;
    }

    if (resolution.kind === 'mdns-single' && resolution.connected) {
      autoConnectMessage.value = 'تم العثور على سيرفر واحد، جاري الاتصال...';
      setTimeout(() => router.replace({ name: 'Login' }), 500);
      return;
    }

    if (resolution.kind === 'mdns-multiple') {
      discoveredServers.value = resolution.servers || [];
      manualMode.value = false;
      return;
    }

    // None found, or single-server connect failed: fall through to manual UI.
    if (resolution.error) {
      connectionResult.value = { success: false, error: resolution.error };
    }
    manualMode.value = true;
  } finally {
    discovering.value = false;
  }
}

async function handleRescan() {
  manualMode.value = false;
  connectionResult.value = null;
  await runAutoFlow();
}

async function handleConnectSelected() {
  const picked = discoveredServers.value.find((s) => s.id === selectedServerId.value);
  if (!picked) return;
  connecting.value = true;
  connectionResult.value = null;
  try {
    const result = await connectToDiscoveredServer(picked);
    connectionResult.value = result;
    if (result.success) {
      autoConnectMessage.value = 'متصل';
      setTimeout(() => router.replace({ name: 'Login' }), 300);
    }
  } finally {
    connecting.value = false;
  }
}

async function handleConnectManual() {
  const { valid } = await localFormRef.value.validate();
  if (!valid) return;

  connecting.value = true;
  connectionResult.value = null;
  try {
    const result = await connectionStore.connect(host.value, port.value, { mode: 'manual' });
    connectionResult.value = result;
    if (result.success) {
      setTimeout(() => router.replace({ name: 'Login' }), 300);
    }
  } finally {
    connecting.value = false;
  }
}

async function handleConnectRemote() {
  const { valid } = await remoteFormRef.value.validate();
  if (!valid) return;

  connecting.value = true;
  connectionResult.value = null;
  try {
    const result = await connectViaRemoteUrl(remoteUrl.value);
    connectionResult.value = result;
    if (result.success) {
      setTimeout(() => router.replace({ name: 'Login' }), 300);
    }
  } finally {
    connecting.value = false;
  }
}

async function useSaved() {
  connecting.value = true;
  connectionResult.value = null;
  const ok = await connectionStore.verifySavedConnection();
  connecting.value = false;

  if (ok) {
    router.replace({ name: 'Login' });
  } else {
    connectionResult.value = {
      success: false,
      error: connectionStore.connectionError || 'لا يمكن الوصول إلى الخادم المحفوظ',
    };
  }
}

// Silence the unused-import warning for discoverServers — kept exposed so
// future UI iterations can drive partial rescans (e.g. on-tab change) without
// reaching back into the store.
void discoverServers;
</script>
