import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const FEATURE_LABELS = {
  installments: 'الأقساط',
  draftInvoices: 'فواتير المسودة',
  multiBranch: 'تعدد الفروع',
  multiWarehouse: 'تعدد المخازن',
  inventoryTransfers: 'تحويلات المخزون',
  warehouseTransfers: 'تحويلات المخازن',
};

/**
 * Resolves the visibility/disabled/reason triplet for a feature-gated UI
 * element. Lets a button render as disabled with a tooltip when the feature
 * flag is off but the user still has the underlying capability — instead
 * of disappearing silently. When the user lacks the capability outright,
 * `visible` becomes false so the element can be `v-if`'d out entirely.
 */
export function useFeatureGate(feature, capability) {
  const authStore = useAuthStore();

  const hasCapability = computed(() =>
    capability ? authStore.can(capability) : true
  );
  const featureOn = computed(() =>
    feature ? authStore.hasFeature(feature) : true
  );

  const visible = computed(() => hasCapability.value);
  const disabled = computed(() => !featureOn.value);
  const enabled = computed(() => hasCapability.value && featureOn.value);

  const reason = computed(() => {
    if (!hasCapability.value) return 'لا تملك صلاحية استخدام هذه الميزة';
    if (!featureOn.value) {
      const label = FEATURE_LABELS[feature] || feature;
      return `ميزة "${label}" معطّلة من إعدادات الميزات. اطلب من المدير تفعيلها.`;
    }
    return '';
  });

  return { visible, disabled, enabled, reason };
}
