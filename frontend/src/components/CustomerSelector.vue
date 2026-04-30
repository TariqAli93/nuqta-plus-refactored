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
              :hint="phoneHint"
              :error-messages="phoneError ? [phoneError] : []"
              persistent-hint
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

    <!-- Duplicate-phone confirmation: shared family numbers are allowed but
         only after the user explicitly opts in. -->
    <v-dialog v-model="duplicateDialog" max-width="480" persistent>
      <v-card>
        <v-card-title class="text-warning">
          <v-icon start color="warning">mdi-alert-circle</v-icon>
          رقم الهاتف مستخدم بالفعل
        </v-card-title>
        <v-card-text>
          <p class="mb-2">
            هذا الرقم مسجّل لدى عميل آخر:
            <strong v-if="duplicateExisting">
              {{ duplicateExisting.name }}
              <span v-if="duplicateExisting.phone" class="text-grey">({{ duplicateExisting.phone }})</span>
            </strong>
          </p>
          <p class="text-body-2 text-grey">
            لن يتم دمج العميلين. هل تريد المتابعة وإضافة هذا العميل بنفس الرقم؟
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="duplicateDialog = false">إلغاء</v-btn>
          <v-btn color="warning" :loading="creating" @click="confirmDuplicateCreate">
            متابعة الإضافة
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useCustomerStore } from '@/stores/customer';
import { useNotificationStore } from '@/stores/notification';
import { normalizeIraqPhone } from '@/utils/phone';

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
const duplicateDialog = ref(false);
const duplicateExisting = ref(null);

const rules = { required: (v) => !!v || 'هذا الحقل مطلوب' };

// Live phone normalization preview / format guard.
const phoneNormalised = computed(() => normalizeIraqPhone(newCustomerData.value.phone));
const phoneHint = computed(() => {
  const raw = (newCustomerData.value.phone || '').trim();
  if (!raw) return '';
  if (phoneNormalised.value && phoneNormalised.value !== raw.replace(/\D/g, '')) {
    return `سيتم البحث وحفظ هذا الرقم بصيغة موحّدة: ${phoneNormalised.value}`;
  }
  return '';
});
const phoneError = computed(() => {
  const raw = (newCustomerData.value.phone || '').trim();
  if (!raw) return '';
  if (!phoneNormalised.value) {
    return 'تنسيق رقم الهاتف غير مفهوم — تأكّد من الأرقام';
  }
  return '';
});

// Autocomplete items with "add new" option
const autocompleteItems = computed(() => {
  const items = [...customers.value];
  const query = searchQuery.value?.trim();

  if (query && query.length >= 2) {
    // البحث عن التكرارات (نفس الاسم بالضبط)
    const duplicateNames = items.filter((c) => c.name?.toLowerCase() === query.toLowerCase());

    // إذا لم يوجد اسم مطابق أو يوجد تكرار، أظهر خيار إضافة جديد
    if (duplicateNames.length === 0 || duplicateNames.length > 1) {
      items.unshift({
        id: 'new-customer',
        name: `إضافة عميل جديد: "${query}"`,
        isNewCustomer: true,
        searchText: query,
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
    // Phone left blank intentionally — never auto-fabricate a phone
    // (it silently created junk numbers like "1", "2", … and tripped the
    // duplicate guard for legitimate later entries).
    newCustomerData.value.phone = '';
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

// Submit the new-customer payload. The duplicate-phone path is delegated
// entirely to the backend (which knows the canonical normalized form);
// the local list might be paginated and miss a duplicate, so we never
// short-circuit on the in-memory `customers` array.
async function submitNewCustomer({ allowDuplicatePhone = false } = {}) {
  creating.value = true;
  try {
    const payload = { ...newCustomerData.value };
    if (allowDuplicatePhone) payload.allowDuplicatePhone = true;
    const response = await customerStore.createCustomer(payload);
    const newCustomer = response.data;
    if (!newCustomer) throw new Error('Invalid response');

    customers.value.unshift(newCustomer);
    selectCustomer(newCustomer);
    duplicateDialog.value = false;
    resetNewCustomerForm();
    notification.success(`تم إضافة العميل: ${newCustomer.name}`);
  } catch (error) {
    const data = error?.response?.data;
    if (data?.code === 'CUSTOMER_PHONE_DUPLICATE') {
      duplicateExisting.value = data.details?.existingCustomer || null;
      duplicateDialog.value = true;
      return;
    }
    const msg = data?.message || error?.message || 'فشل في إضافة العميل الجديد';
    notification.error(msg);
  } finally {
    creating.value = false;
  }
}

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
  await submitNewCustomer();
}

const confirmDuplicateCreate = () => submitNewCustomer({ allowDuplicatePhone: true });

function cancelNewCustomer() {
  showNewCustomerForm.value = false;
  resetNewCustomerForm();
}

function resetNewCustomerForm() {
  newCustomerData.value = { name: '', phone: '', city: '', address: '', notes: '' };
  showNewCustomerForm.value = false;
  duplicateDialog.value = false;
  duplicateExisting.value = null;
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
