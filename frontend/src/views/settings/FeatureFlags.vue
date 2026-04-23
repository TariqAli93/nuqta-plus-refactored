<template>
  <v-container max-width="860">
    <v-card class="mb-4" rounded="xl">
      <div class="flex items-center justify-space-between pa-4">
        <div>
          <div class="font-weight-bold text-h6">إعدادات الميزات</div>
          <div class="text-caption text-medium-emphasis">
            فعّل الوحدات التي تحتاجها فقط. الميزات المعطّلة تختفي من الواجهة.
          </div>
        </div>
        <v-btn
          color="primary"
          prepend-icon="mdi-wizard-hat"
          :to="{ name: 'SetupWizard' }"
        >
          معالج الإعداد
        </v-btn>
      </div>
    </v-card>

    <v-card v-for="group in groups" :key="group.title" class="mb-4" rounded="xl">
      <v-card-title class="d-flex align-center gap-2">
        <v-icon :color="group.color">{{ group.icon }}</v-icon>
        <span>{{ group.title }}</span>
      </v-card-title>
      <v-divider />
      <v-list lines="two">
        <v-list-item v-for="item in group.items" :key="item.key">
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
              :disabled="!canManage || saving"
              @update:model-value="(val) => toggle(item.key, val)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <v-alert
      v-if="!canManage"
      type="info"
      variant="tonal"
      density="compact"
      text="للتغيير تحتاج صلاحية المدير العام."
    />
  </v-container>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import api from '@/plugins/axios';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';

const authStore = useAuthStore();
const notify = useNotificationStore();

const flags = reactive({ ...(authStore.featureFlags || {}) });
const saving = ref(false);

const canManage = computed(() => authStore.hasPermission('manage_feature_toggles'));

// Grouped so the page reads like a product settings screen, not a developer flag list.
const groups = [
  {
    title: 'المبيعات',
    icon: 'mdi-cash-register',
    color: 'primary',
    items: [
      {
        key: 'installments',
        title: 'بيع بالأقساط',
        description: 'تفعيل الدفعات المؤجلة وجدولة الأقساط.',
        icon: 'mdi-calendar-clock',
      },
      {
        key: 'creditScore',
        title: 'تقييم العملاء',
        description: 'نظام السكور الائتماني وتوصية السقف المالي.',
        icon: 'mdi-chart-line',
      },
    ],
  },
  {
    title: 'المخزون',
    icon: 'mdi-warehouse',
    color: 'secondary',
    items: [
      {
        key: 'inventory',
        title: 'إدارة المخزون',
        description: 'تتبع المخزون لكل منتج، التعديلات اليدوية، والحركات.',
        icon: 'mdi-package-variant',
      },
      {
        key: 'multiBranch',
        title: 'تعدد الفروع',
        description: 'دعم أكثر من فرع وربط المستخدمين بفروع.',
        icon: 'mdi-store',
      },
      {
        key: 'multiWarehouse',
        title: 'تعدد المخازن',
        description: 'أكثر من مخزن لكل فرع مع رصيد مستقل.',
        icon: 'mdi-warehouse',
      },
      {
        key: 'warehouseTransfers',
        title: 'نقل بين المخازن',
        description: 'إنشاء طلبات نقل ومراجعتها قبل تنفيذها.',
        icon: 'mdi-transfer',
      },
    ],
  },
  {
    title: 'التنبيهات والمتابعة',
    icon: 'mdi-bell',
    color: 'warning',
    items: [
      {
        key: 'alerts',
        title: 'التنبيهات',
        description: 'تنبيهات نظامية لحظية (مبيعات، مخزون، أقساط).',
        icon: 'mdi-bell',
      },
      {
        key: 'liveOperations',
        title: 'العمليات الحيّة',
        description: 'متابعة العمليات الحالية في الوقت الفعلي.',
        icon: 'mdi-pulse',
      },
    ],
  },
];

const load = async () => {
  try {
    const response = await api.get('/feature-flags');
    const data = response.data || {};
    const remote = data.flags || data; // tolerate both shapes
    Object.assign(flags, remote);
    authStore.setFeatureFlags({ ...flags });
  } catch {
    /* handled globally */
  }
};

const toggle = async (key, value) => {
  if (!canManage.value || saving.value) return;
  const previous = flags[key];
  flags[key] = value;
  saving.value = true;
  try {
    const response = await api.put('/feature-flags', { [key]: value });
    Object.assign(flags, response.data || {});
    authStore.setFeatureFlags({ ...flags });
    notify.success('تم حفظ التغيير');
  } catch {
    flags[key] = previous;
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>
