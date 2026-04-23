<template>
  <v-container max-width="760" class="py-8">
    <div class="text-center mb-8">
      <div class="text-h4 font-weight-bold mb-2">مرحباً في نقطة بلس 👋</div>
      <div class="text-body-1 text-medium-emphasis">
        اختر طريقة استخدامك للنظام وسيقوم البرنامج بتهيئة نفسه تلقائياً. يمكن تغيير أي شيء لاحقاً من الإعدادات.
      </div>
    </div>

    <v-row>
      <v-col v-for="preset in presets" :key="preset.id" cols="12" md="4">
        <v-card
          :variant="selected === preset.id ? 'tonal' : 'outlined'"
          :color="selected === preset.id ? 'primary' : undefined"
          class="preset-card h-full pa-3 cursor-pointer"
          @click="selected = preset.id"
        >
          <div class="flex items-center gap-3 mb-2">
            <v-avatar :color="preset.color" size="40">
              <v-icon color="white">{{ preset.icon }}</v-icon>
            </v-avatar>
            <div class="text-h6 font-weight-bold">{{ preset.title }}</div>
          </div>
          <div class="text-body-2 text-medium-emphasis mb-3">{{ preset.description }}</div>
          <v-list density="compact" lines="one" class="pa-0 bg-transparent">
            <v-list-item
              v-for="f in preset.features"
              :key="f.key"
              class="px-0"
              :prepend-icon="f.on ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
            >
              <v-list-item-title :class="f.on ? 'text-success' : 'text-medium-emphasis'">
                {{ f.label }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <div class="flex justify-center mt-6 gap-2">
      <v-btn variant="text" @click="skip">تخطي الآن</v-btn>
      <v-btn color="primary" size="large" :loading="saving" :disabled="!selected" @click="apply">
        متابعة
      </v-btn>
    </div>
  </v-container>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '@/plugins/axios';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';

const router = useRouter();
const authStore = useAuthStore();
const notify = useNotificationStore();

const selected = ref('simple');
const saving = ref(false);

const presets = [
  {
    id: 'simple',
    title: 'بيع بسيط',
    icon: 'mdi-cash-register',
    color: 'primary',
    description: 'متجر واحد، بيع نقدي فقط، إدارة مخزون بسيطة.',
    features: [
      { key: 'inventory', label: 'إدارة المخزون', on: true },
      { key: 'installments', label: 'أقساط', on: false },
      { key: 'creditScore', label: 'تقييم العملاء', on: false },
      { key: 'multiBranch', label: 'تعدد الفروع', on: false },
    ],
  },
  {
    id: 'installments',
    title: 'بيع + أقساط',
    icon: 'mdi-calendar-clock',
    color: 'secondary',
    description: 'مع دفعات مؤجلة، متابعة عملاء، وتقييم ائتماني.',
    features: [
      { key: 'inventory', label: 'إدارة المخزون', on: true },
      { key: 'installments', label: 'أقساط', on: true },
      { key: 'creditScore', label: 'تقييم العملاء', on: true },
      { key: 'multiBranch', label: 'تعدد الفروع', on: false },
    ],
  },
  {
    id: 'multi_branch',
    title: 'أعمال بفروع متعددة',
    icon: 'mdi-store',
    color: 'success',
    description: 'فروع متعددة، مخازن، ونقل مع موافقات.',
    features: [
      { key: 'inventory', label: 'إدارة المخزون', on: true },
      { key: 'installments', label: 'أقساط', on: true },
      { key: 'multiBranch', label: 'تعدد الفروع', on: true },
      { key: 'multiWarehouse', label: 'تعدد المخازن', on: true },
      { key: 'warehouseTransfers', label: 'نقل بين المخازن', on: true },
    ],
  },
];

const apply = async () => {
  if (!selected.value) return;
  saving.value = true;
  try {
    const response = await api.post('/feature-flags/setup', { preset: selected.value });
    authStore.setFeatureFlags(response.data || {});
    authStore.setupMode = 'done';
    localStorage.setItem('setupMode', 'done');
    notify.success('تم تهيئة النظام بنجاح');
    router.replace({ name: 'Dashboard' });
  } catch {
    /* handled globally */
  } finally {
    saving.value = false;
  }
};

const skip = () => {
  // Mark done locally so the wizard doesn't loop, but keep the flags as-is.
  authStore.setupMode = 'done';
  localStorage.setItem('setupMode', 'done');
  router.replace({ name: 'Dashboard' });
};
</script>

<style scoped>
.preset-card {
  transition: all 0.15s ease;
}
.preset-card:hover {
  transform: translateY(-2px);
}
</style>
