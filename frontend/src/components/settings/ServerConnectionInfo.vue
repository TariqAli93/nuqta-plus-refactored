<template>
  <v-card flat>
    <v-card-title class="text-h6 pa-4 pb-2 d-flex align-center">
      <v-icon class="me-2" color="primary">mdi-server</v-icon>
      معلومات الخادم
    </v-card-title>

    <v-card-text>
      <!-- Loading -->
      <div v-if="loading" class="d-flex justify-center pa-8">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <!-- Error -->
      <v-alert v-else-if="error" type="error" variant="tonal" class="mb-4">
        {{ error }}
      </v-alert>

      <template v-else>
        <!-- Status -->
        <v-alert
          type="success"
          variant="tonal"
          class="mb-4"
          icon="mdi-check-network"
        >
          <div class="font-weight-bold">الخادم يعمل</div>
          <div v-if="serverInfo" class="text-body-2 mt-1">
            {{ serverInfo.name }} - v{{ serverInfo.version }}
          </div>
        </v-alert>

        <!-- Server Details -->
        <v-table v-if="serverInfo" density="compact">
          <tbody>
            <tr>
              <td class="text-medium-emphasis font-weight-medium" style="width: 40%">اسم الخادم</td>
              <td>{{ serverInfo.name }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">الإصدار</td>
              <td dir="ltr" class="text-start">{{ serverInfo.version }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">الوضع</td>
              <td>
                <v-chip size="small" color="primary" variant="tonal">
                  خادم محلي
                </v-chip>
              </td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">العنوان</td>
              <td dir="ltr" class="text-start">{{ serverInfo.host || '127.0.0.1' }}</td>
            </tr>
            <tr>
              <td class="text-medium-emphasis font-weight-medium">المنفذ</td>
              <td dir="ltr" class="text-start">{{ serverInfo.port || '41732' }}</td>
            </tr>
            <tr v-if="serverInfo.timestamp">
              <td class="text-medium-emphasis font-weight-medium">وقت الاستجابة</td>
              <td>{{ formatDate(serverInfo.timestamp) }}</td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </v-card-text>

    <v-card-actions class="pa-4 pt-0">
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetchInfo"
      >
        تحديث
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

const loading = ref(true);
const error = ref(null);
const serverInfo = ref(null);

async function fetchInfo() {
  loading.value = true;
  error.value = null;

  try {
    const response = await axios.get('http://127.0.0.1:41732/server-info', { timeout: 5000 });
    serverInfo.value = response.data;
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      error.value = 'انتهت مهلة الاتصال بالخادم';
    } else if (err.message === 'Network Error') {
      error.value = 'لا يمكن الوصول إلى الخادم المحلي';
    } else {
      error.value = `فشل جلب معلومات الخادم: ${err.message}`;
    }
  } finally {
    loading.value = false;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('ar-IQ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn',
    });
  } catch {
    return dateStr;
  }
}

onMounted(fetchInfo);
</script>
