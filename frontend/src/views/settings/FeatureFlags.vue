<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div>
          <div class="font-semibold text-h6 text-primary">إعدادات الميزات</div>
          <div class="text-caption text-medium-emphasis">
            تفعيل أو تعطيل الوحدات الاختيارية — تظهر أو تختفي تلقائياً من الواجهة
          </div>
        </div>
      </div>
    </v-card>

    <v-card>
      <v-list lines="two">
        <v-list-item v-for="item in items" :key="item.key">
          <template #prepend>
            <v-icon :color="flags[item.key] ? 'success' : 'grey'">{{ item.icon }}</v-icon>
          </template>
          <v-list-item-title>{{ item.title }}</v-list-item-title>
          <v-list-item-subtitle>{{ item.description }}</v-list-item-subtitle>
          <template #append>
            <v-switch
              :model-value="flags[item.key]"
              color="primary"
              hide-details
              inset
              :disabled="!canManage"
              @update:model-value="(val) => toggle(item.key, val)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import api from '@/plugins/axios';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';

const authStore = useAuthStore();
const notify = useNotificationStore();

const flags = reactive({ ...(authStore.featureFlags || {}) });
const saving = ref(false);

const canManage = computed(() => authStore.hasPermission('manage_feature_toggles'));

const items = [
  { key: 'installments', title: 'الأقساط', description: 'بيع بالتقسيط وإدارة الدفعات', icon: 'mdi-calendar-clock' },
  { key: 'creditScore', title: 'تقييم ائتمان العميل', description: 'نظام السكور الائتماني للعملاء', icon: 'mdi-chart-line' },
  { key: 'inventory', title: 'إدارة المخزون', description: 'تفعيل وحدة المخزون كاملة', icon: 'mdi-warehouse' },
  { key: 'multiBranch', title: 'تعدد الفروع', description: 'دعم أكثر من فرع', icon: 'mdi-store' },
  { key: 'multiWarehouse', title: 'تعدد المخازن', description: 'دعم أكثر من مخزن لكل فرع', icon: 'mdi-package-variant' },
  { key: 'warehouseTransfers', title: 'نقل بين المخازن', description: 'طلبات النقل والموافقة', icon: 'mdi-transfer' },
  { key: 'alerts', title: 'التنبيهات', description: 'تنبيهات وإشعارات النظام', icon: 'mdi-bell' },
  { key: 'liveOperations', title: 'العمليات الحيّة', description: 'متابعة العمليات في الوقت الحقيقي', icon: 'mdi-pulse' },
];

const load = async () => {
  try {
    const response = await api.get('/feature-flags');
    Object.assign(flags, response.data || {});
    authStore.setFeatureFlags({ ...flags });
  } catch {
    /* handled globally */
  }
};

const toggle = async (key, value) => {
  if (!canManage.value) return;
  if (saving.value) return;
  const previous = flags[key];
  flags[key] = value;
  saving.value = true;
  try {
    const response = await api.put('/feature-flags', { [key]: value });
    Object.assign(flags, response.data || {});
    authStore.setFeatureFlags({ ...flags });
    notify.success('تم تحديث الإعدادات');
  } catch {
    flags[key] = previous;
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>
