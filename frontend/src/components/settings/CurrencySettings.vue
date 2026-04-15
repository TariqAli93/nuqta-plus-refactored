<template>
  <div class="currency-settings">
    <!-- 🔹 شريط الأدوات العلوي -->
    <v-card class="mb-4" elevation="2">
      <v-card-text class="pa-4">
        <div class="d-flex justify-space-between align-center flex-wrap ga-2">
          <div class="d-flex align-center">
            <v-icon color="primary" size="28" class="me-3">mdi-currency-usd</v-icon>
            <h2 class="text-h5 font-weight-bold text-primary">إعدادات العملة</h2>
          </div>
          <v-btn
            color="primary"
            size="default"
            prepend-icon="mdi-content-save"
            class="rounded-lg"
            :loading="settingsStore.isLoading"
            :disabled="!isFormValid"
            @click="saveCurrencySettings"
          >
            حفظ الإعدادات
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card class="mb-4" elevation="1">
      <v-card-text class="pa-6">
        <v-form ref="formRef" v-model="isFormValid">
          <v-row>
            <!-- Default Currency -->
            <v-col cols="12" md="12">
              <v-select
                v-model="currencyData.defaultCurrency"
                label="العملة الافتراضية *"
                :items="currencies"
                :rules="[rules.required]"
                variant="outlined"
                density="comfortable"
                item-title="text"
                item-value="value"
                prepend-inner-icon="mdi-currency-usd"
                required
              >
                <template #selection="{ item }">
                  <v-chip :color="item.raw.color" size="small" class="ma-1">
                    <v-icon start size="18">{{ item.raw.icon }}</v-icon>
                    {{ item.raw.text }}
                  </v-chip>
                </template>
                <template #item="{ props, item }">
                  <v-list-item
                    v-bind="props"
                    :prepend-icon="item.raw.icon"
                    :title="item.raw.text"
                    :subtitle="item.raw.subtitle"
                  ></v-list-item>
                </template>
              </v-select>
            </v-col>

            <!-- Exchange Rates Section -->
            <v-col cols="12">
              <v-divider class="my-4" />
              <div class="d-flex align-center mb-4">
                <v-icon class="me-2" color="info" size="24">mdi-swap-horizontal</v-icon>
                <h3 class="text-h6 font-weight-bold">أسعار الصرف</h3>
              </div>
            </v-col>

            <!-- USD Exchange Rate -->
            <v-col cols="12" md="6" :class="{ 'transition-all': true }">
              <v-text-field
                v-model.number="currencyData.usdRate"
                label="سعر صرف الدولار (USD) *"
                :rules="[rules.required, rules.positiveNumber]"
                variant="outlined"
                density="comfortable"
                type="number"
                prepend-inner-icon="mdi-currency-usd"
                suffix="IQD"
                hint="سعر الدولار مقابل الدينار العراقي"
                persistent-hint
                required
              />
            </v-col>

            <!-- IQD Exchange Rate -->
            <v-col cols="12" md="6" :class="{ 'transition-all': true }">
              <v-text-field
                v-model.number="currencyData.iqdRate"
                label="سعر صرف الدينار (IQD) *"
                :rules="[rules.required, rules.positiveNumber]"
                variant="outlined"
                density="comfortable"
                type="number"
                prepend-inner-icon="mdi-currency-ils"
                disabled
                hint="القيمة الافتراضية للدينار العراقي"
                persistent-hint
                required
              />
            </v-col>

            <!-- Info Card -->
            <v-col cols="12">
              <v-card variant="tonal" color="info" class="pa-4" elevation="0">
                <div class="d-flex align-start">
                  <v-icon size="24" class="me-3 mt-1">mdi-information</v-icon>
                  <div>
                    <h4 class="text-subtitle-1 font-weight-bold mb-2">معلومات مهمة</h4>
                    <ul class="text-body-2 mb-0 pl-4" style="list-style-type: disc">
                      <li>العملة الافتراضية ستستخدم في جميع عمليات البيع الجديدة</li>
                      <li>يمكنك تغيير أسعار الصرف في أي وقت</li>
                      <li>التغييرات ستؤثر على العمليات الجديدة فقط</li>
                    </ul>
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';

// Stores
const settingsStore = useSettingsStore();

// Refs
const formRef = ref();
const isFormValid = ref(false);

// Currency options
const currencies = [
  {
    text: 'الدينار العراقي',
    value: 'IQD',
    icon: 'mdi-currency-ils',
    color: 'green',
    subtitle: 'العملة المحلية',
  },
  {
    text: 'الدولار الأمريكي',
    value: 'USD',
    icon: 'mdi-currency-usd',
    color: 'blue',
    subtitle: 'العملة الدولية',
  },
];

// Reactive data
const currencyData = ref({
  defaultCurrency: 'IQD',
  usdRate: 1500,
  iqdRate: 1,
});

// Validation rules
const rules = {
  required: (value) => !!value || 'هذا الحقل مطلوب',
  positiveNumber: (value) => (value && value > 0) || 'يجب أن تكون القيمة أكبر من صفر',
};

// Save currency settings
const saveCurrencySettings = async () => {
  if (!isFormValid.value) return;

  console.log('Saving currency settings:', currencyData.value);

  try {
    await settingsStore.saveCurrencySettings(currencyData.value);
  } catch {
    // Error handled by notification
  }
};

// Lifecycle
onMounted(async () => {
  try {
    const settings = await settingsStore.fetchCurrencySettings();
    if (settings) {
      currencyData.value = {
        defaultCurrency: settings.defaultCurrency || 'IQD',
        usdRate: settings.usdRate || 1500,
        iqdRate: settings.iqdRate || 1,
      };
    }
  } catch {
    // Error handled by notification
  }
});
</script>

<style scoped>
.currency-settings {
  width: 100%;
}

.transition-all {
  transition: all 0.3s ease-in-out;
}

/* Smooth transitions for showing/hiding elements */
.v-col {
  transition:
    opacity 0.3s ease-in-out,
    transform 0.3s ease-in-out;
}

/* Improve card spacing */
.v-card {
  border-radius: 12px;
}

/* Better form field spacing */
.v-text-field,
.v-select {
  margin-bottom: 8px;
}
</style>
