<template>
  <v-card flat>
    <v-card-title class="text-h6 pa-4 pb-2 d-flex align-center">
      <v-icon class="me-2" color="primary">mdi-server-network</v-icon>
      إعدادات الاتصال بالخادم
    </v-card-title>

    <v-card-text>
      <!-- Current Connection Status -->
      <v-alert
        :type="connectionStore.isConnected ? 'success' : 'warning'"
        variant="tonal"
        class="mb-4"
        :icon="connectionStore.isConnected ? 'mdi-check-network' : 'mdi-network-off'"
      >
        <div class="font-weight-bold">
          {{ connectionStore.isConnected ? 'متصل بالخادم' : 'غير متصل' }}
        </div>
        <div v-if="connectionStore.isConnected && connectionStore.serverInfo" class="text-body-2 mt-1">
          {{ connectionStore.serverInfo.name }} - v{{ connectionStore.serverInfo.version }}
        </div>
      </v-alert>

      <!-- Current Connection Details -->
      <v-table v-if="connectionStore.isConnected" class="mb-4" density="compact">
        <tbody>
          <tr>
            <td class="text-medium-emphasis font-weight-medium" style="width: 40%">عنوان الخادم</td>
            <td dir="ltr" class="text-start">{{ connectionStore.serverHost }}</td>
          </tr>
          <tr>
            <td class="text-medium-emphasis font-weight-medium">المنفذ</td>
            <td dir="ltr" class="text-start">{{ connectionStore.serverPort }}</td>
          </tr>
          <tr v-if="connectionStore.serverInfo?.version">
            <td class="text-medium-emphasis font-weight-medium">إصدار الخادم</td>
            <td dir="ltr" class="text-start">{{ connectionStore.serverInfo.version }}</td>
          </tr>
        </tbody>
      </v-table>

      <v-divider class="mb-4" />

      <!-- Edit Connection Form -->
      <div class="text-subtitle-2 mb-3">تعديل الاتصال</div>

      <v-form ref="formRef" @submit.prevent="handleConnect">
        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="host"
              label="عنوان الخادم (IP)"
              placeholder="192.168.1.100"
              variant="outlined"
              density="comfortable"
              dir="ltr"
              :rules="[rules.required, rules.validHost]"
              prepend-inner-icon="mdi-ip-network"
            />
          </v-col>
          <v-col cols="12" md="6">
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
            />
          </v-col>
        </v-row>

        <!-- Test Result -->
        <v-alert
          v-if="testResult"
          :type="testResult.success ? 'success' : 'error'"
          variant="tonal"
          density="compact"
          class="mb-4"
          closable
          @click:close="testResult = null"
        >
          <template v-if="testResult.success">
            <div>تم الاتصال بنجاح</div>
            <div v-if="testResult.info" class="text-caption mt-1">
              {{ testResult.info.name }} - v{{ testResult.info.version }}
            </div>
          </template>
          <template v-else>
            {{ testResult.error }}
          </template>
        </v-alert>

        <div class="d-flex ga-2">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-lan-check"
            :loading="testing"
            :disabled="!host"
            @click="handleTest"
          >
            اختبار الاتصال
          </v-btn>
          <v-btn
            type="submit"
            color="primary"
            prepend-icon="mdi-content-save"
            :loading="connecting"
            :disabled="!host"
          >
            حفظ والاتصال
          </v-btn>
        </div>
      </v-form>

      <!-- Disconnect -->
      <div v-if="connectionStore.isConnected" class="mt-6">
        <v-divider class="mb-4" />
        <v-btn
          color="error"
          variant="tonal"
          prepend-icon="mdi-link-off"
          @click="handleDisconnect"
        >
          قطع الاتصال
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useConnectionStore } from '@/stores/connection';
import { useNotificationStore } from '@/stores/notification';

const connectionStore = useConnectionStore();
const notificationStore = useNotificationStore();

const formRef = ref(null);
const host = ref(connectionStore.serverHost || '');
const port = ref(connectionStore.serverPort || 41732);
const testing = ref(false);
const connecting = ref(false);
const testResult = ref(null);

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
  validHost: (v) => {
    if (!v) return true;
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
  host.value = connectionStore.serverHost || '';
  port.value = connectionStore.serverPort || 41732;
});

async function handleTest() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  testing.value = true;
  testResult.value = null;

  const result = await connectionStore.testConnection(host.value, port.value);
  testResult.value = result;
  testing.value = false;
}

async function handleConnect() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  connecting.value = true;
  testResult.value = null;

  const result = await connectionStore.connect(host.value, port.value);
  testResult.value = result;
  connecting.value = false;

  if (result.success) {
    notificationStore.success('تم حفظ إعدادات الاتصال بنجاح');
  }
}

function handleDisconnect() {
  connectionStore.clearConnection();
  host.value = '';
  port.value = 41732;
  testResult.value = null;
  notificationStore.success('تم قطع الاتصال');
}
</script>
