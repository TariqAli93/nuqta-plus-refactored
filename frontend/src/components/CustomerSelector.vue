<template>
  <div class="customer-selector">
    <v-autocomplete
      v-model="selectedId"
      :items="autocompleteItems"
      item-title="name"
      item-value="id"
      :label="showLabel ? 'العميل' : undefined"
      :rules="required ? [rules.required] : []"
      density="comfortable"
      variant="outlined"
      clearable
      :loading="loading"
      no-data-text="لا توجد نتائج"
      @update:model-value="handleSelect"
      @update:search="handleSearch"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item
          v-bind="itemProps"
          :class="{ 'add-new-customer-item': item.raw.isNewCustomer }"
        >
          <template #prepend>
            <v-icon v-if="item.raw.isNewCustomer" color="primary">mdi-plus-circle</v-icon>
            <v-icon v-else>mdi-account</v-icon>
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>

    <!-- New Customer Dialog -->
    <v-dialog v-model="showNewCustomerForm" max-width="600" persistent>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span class="text-h6">إضافة عميل جديد</span>
          <v-btn icon="mdi-close" variant="text" @click="cancelNewCustomer" />
        </v-card-title>
        <v-card-text>
          <v-form ref="newCustomerForm">
            <v-text-field
              v-model="newCustomerData.name"
              label="اسم العميل"
              :rules="[rules.required]"
              density="comfortable"
              variant="outlined"
              class="mb-3"
            />
            <v-text-field
              v-model="newCustomerData.phone"
              label="رقم الهاتف"
              density="comfortable"
              variant="outlined"
              class="mb-3"
            />
            <v-text-field
              v-model="newCustomerData.city"
              label="المدينة"
              density="comfortable"
              variant="outlined"
              class="mb-3"
            />
            <v-textarea
              v-model="newCustomerData.address"
              label="العنوان"
              density="comfortable"
              variant="outlined"
              rows="2"
              class="mb-3"
            />
            <v-textarea
              v-model="newCustomerData.notes"
              label="ملاحظات"
              density="comfortable"
              variant="outlined"
              rows="2"
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelNewCustomer">إلغاء</v-btn>
          <v-btn color="primary" :loading="creating" @click="createNewCustomer">إضافة</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useCustomerStore } from '@/stores/customer';
import { useNotificationStore } from '@/stores/notification';

const props = defineProps({
  modelValue: { type: [Number, Object], default: null },
  required: { type: Boolean, default: false },
  showLabel: { type: Boolean, default: true },
});

const emit = defineEmits(['update:modelValue', 'customer-selected']);
const customerStore = useCustomerStore();
const notification = useNotificationStore();

// State
const showSelector = ref(!props.modelValue);
const searchQuery = ref('');
const customers = ref([]);
const loading = ref(false);
const selectedId = ref(props.modelValue);
const selectedCustomer = ref(null);
const showNewCustomerForm = ref(false);
const newCustomerForm = ref(null);
const creating = ref(false);
const newCustomerData = ref({ name: '', phone: '', city: '', address: '', notes: '' });

const rules = { required: (v) => !!v || 'هذا الحقل مطلوب' };

// Generate default phone number based on next customer ID
function generateDefaultPhone() {
  if (customers.value.length === 0) return '1';
  const maxId = Math.max(...customers.value.map((c) => c.id || 0));
  return String(maxId + 1);
}

// Autocomplete items with "add new" option
const autocompleteItems = computed(() => {
  const items = [...customers.value];
  const query = searchQuery.value?.trim();

  if (query && query.length >= 2) {
    // البحث عن التكرارات (نفس الاسم بالضبط)
    const duplicateNames = items.filter((c) => c.name?.toLowerCase() === query.toLowerCase());

    // إذا لم يوجد اسم مطابق أو يوجد تكرار، أظهر خيار إضافة جديد
    if (duplicateNames.length === 0 || duplicateNames.length > 1) {
      // إنشاء رقم هاتف افتراضي من customerId (آخر ID + 1 أو timestamp)
      const defaultPhone = generateDefaultPhone();

      items.unshift({
        id: 'new-customer',
        name: `إضافة عميل جديد: "${query}"`,
        isNewCustomer: true,
        searchText: query,
        defaultPhone: defaultPhone,
      });
    }
  }
  return items;
});

// Search customers
async function handleSearch(query) {
  searchQuery.value = query || '';
  if (query === null || query === undefined) {
    query = '';
  }

  loading.value = true;
  try {
    const params = query && query.length >= 2 ? { search: query, limit: 20 } : { limit: 50 };
    const { data } = await customerStore.fetch(params);
    customers.value = data || [];
  } catch {
    customers.value = [];
  } finally {
    loading.value = false;
  }
}

// Handle selection
function handleSelect(value) {
  if (!value) {
    selectedId.value = null;
    emit('update:modelValue', null);
    return;
  }

  if (value === 'new-customer') {
    const newCustomerItem = autocompleteItems.value.find((item) => item.id === 'new-customer');
    newCustomerData.value.name = newCustomerItem?.searchText || searchQuery.value;
    newCustomerData.value.phone = newCustomerItem?.defaultPhone || generateDefaultPhone();
    showNewCustomerForm.value = true;
    selectedId.value = null;
    emit('update:modelValue', null);
  } else if (value) {
    const customer = customers.value.find((c) => c.id === value);
    if (customer) {
      selectCustomer(customer);
    }
  }
}

// Select customer
function selectCustomer(customer) {
  selectedCustomer.value = customer;
  selectedId.value = customer.id;
  showSelector.value = false;
  showNewCustomerForm.value = false;
  emit('update:modelValue', customer.id);
  emit('customer-selected', customer);
}

// Create new customer
async function createNewCustomer() {
  if (!newCustomerForm.value?.validate) {
    notification.error('حدث خطأ في النموذج');
    return;
  }

  const { valid } = await newCustomerForm.value.validate();
  if (!valid || !newCustomerData.value.name?.trim()) {
    notification.error('اسم العميل مطلوب');
    return;
  }

  // Check phone uniqueness
  if (newCustomerData.value.phone?.trim()) {
    const exists = customers.value.some((c) => c.phone === newCustomerData.value.phone.trim());
    if (exists) {
      notification.error('رقم الهاتف مستخدم بالفعل من قبل عميل آخر');
      return;
    }
  }

  creating.value = true;
  try {
    const response = await customerStore.createCustomer(newCustomerData.value);
    const newCustomer = response.data;
    if (!newCustomer) throw new Error('Invalid response');

    customers.value.unshift(newCustomer);
    selectCustomer(newCustomer);
    resetNewCustomerForm();
    notification.success(`تم إضافة العميل: ${newCustomer.name}`);
  } catch (error) {
    const msg = error?.response?.data?.message || error?.message || 'فشل في إضافة العميل الجديد';
    if (msg.includes('phone') || msg.includes('Phone')) {
      notification.error('رقم الهاتف مستخدم بالفعل من قبل عميل آخر');
    } else {
      notification.error(msg);
    }
  } finally {
    creating.value = false;
  }
}

function cancelNewCustomer() {
  showNewCustomerForm.value = false;
  resetNewCustomerForm();
}

function resetNewCustomerForm() {
  newCustomerData.value = { name: '', phone: '', city: '', address: '', notes: '' };
  showNewCustomerForm.value = false;
  newCustomerForm.value?.resetValidation?.();
  searchQuery.value = '';
}

// Load customer by ID
async function loadCustomer(id) {
  try {
    const response = await customerStore.fetchCustomer(id);
    selectedCustomer.value = response.data;
    showSelector.value = false;
  } catch {
    selectedCustomer.value = null;
  }
}

// Watch modelValue changes
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== selectedId.value) {
      selectedId.value = newVal;
      if (newVal && (!selectedCustomer.value || selectedCustomer.value.id !== newVal)) {
        loadCustomer(newVal);
      } else if (!newVal) {
        selectedCustomer.value = null;
        showSelector.value = true;
      }
    }
  },
  { immediate: true }
);

// Initialize
onMounted(async () => {
  if (props.modelValue) {
    await loadCustomer(props.modelValue);
  }
  await handleSearch('');
});

// Exposed methods
defineExpose({
  resetSelection() {
    selectedCustomer.value = null;
    selectedId.value = null;
    showSelector.value = true;
    showNewCustomerForm.value = false;
    emit('update:modelValue', null);
  },
});
</script>

<style scoped>
.customer-selector {
  width: 100%;
}
.customer-info {
  flex: 1;
}
.add-new-customer-item {
  background-color: rgba(var(--v-theme-primary), 0.05);
  border-top: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
}
@media (max-width: 600px) {
  .quick-options .v-btn-toggle {
    width: 100%;
  }
  .quick-options .v-btn {
    flex: 1;
    font-size: 0.75rem;
  }
}
</style>
