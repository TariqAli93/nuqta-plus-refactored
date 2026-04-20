<template>
  <v-container class="fill-height d-flex align-center justify-center">
    <v-card max-width="480" class="pa-6" elevation="4" rounded="xl">
      <v-card-title class="text-center pb-2">
        <v-icon size="48" color="primary" class="mb-2">mdi-server-network</v-icon>
        <div class="text-h5">الاتصال بالخادم</div>
        <div class="text-body-2 text-medium-emphasis mt-1">
          أدخل عنوان خادم Nuqta Plus على الشبكة المحلية
        </div>
      </v-card-title>

      <v-card-text class="pt-4">
        <v-form ref="formRef" @submit.prevent="handleConnect">
          <v-text-field
            v-model="host"
            label="عنوان الخادم (IP)"
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

          <!-- Connection status -->
          <v-alert
            v-if="connectionResult"
            :type="connectionResult.success ? 'success' : 'error'"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <template v-if="connectionResult.success">
              <div>تم الاتصال بنجاح</div>
              <div v-if="connectionResult.info" class="text-caption mt-1">
                {{ connectionResult.info.name }} - v{{ connectionResult.info.version }}
              </div>
            </template>
            <template v-else>
              {{ connectionResult.error }}
            </template>
          </v-alert>

          <v-btn
            type="submit"
            color="primary"
            block
            size="large"
            :loading="testing"
            :disabled="!host"
          >
            <v-icon start>mdi-connection</v-icon>
            اتصال
          </v-btn>
        </v-form>
      </v-card-text>

      <v-card-actions v-if="hasSavedConnection" class="justify-center pt-0">
        <v-btn variant="text" color="secondary" size="small" @click="useSaved">
          استخدام الاتصال المحفوظ
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useConnectionStore } from '@/stores/connection';

const router = useRouter();
const connectionStore = useConnectionStore();
const formRef = ref(null);

const host = ref(connectionStore.serverHost || '');
const port = ref(connectionStore.serverPort || 41732);
const testing = ref(false);
const connectionResult = ref(null);

const hasSavedConnection = ref(false);

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
  validHost: (v) => {
    if (!v) return true;
    // Accept IP addresses and hostnames
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    return ipPattern.test(v) || hostnamePattern.test(v) || 'عنوان IP أو اسم مضيف غير صالح';
  },
  validPort: (v) => {
    const n = Number(v);
    return (n >= 1 && n <= 65535) || 'المنفذ يجب أن يكون بين 1 و 65535';
  },
};

onMounted(() => {
  // Check if there's a saved connection that might still work
  if (connectionStore.serverHost) {
    hasSavedConnection.value = true;
    host.value = connectionStore.serverHost;
    port.value = connectionStore.serverPort;
  }
});

async function handleConnect() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  testing.value = true;
  connectionResult.value = null;

  const result = await connectionStore.connect(host.value, port.value);
  connectionResult.value = result;
  testing.value = false;

  if (result.success) {
    // Short delay to show success message before navigating
    setTimeout(() => {
      router.replace({ name: 'Login' });
    }, 500);
  }
}

async function useSaved() {
  testing.value = true;
  connectionResult.value = null;

  const ok = await connectionStore.verifySavedConnection();
  testing.value = false;

  if (ok) {
    router.replace({ name: 'Login' });
  } else {
    connectionResult.value = {
      success: false,
      error: connectionStore.connectionError || 'لا يمكن الوصول إلى الخادم المحفوظ',
    };
  }
}
</script>
