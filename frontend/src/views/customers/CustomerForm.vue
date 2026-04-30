<template>
  <div>
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">
          {{ isEdit ? 'تعديل عميل' : 'عميل جديد' }}
        </div>
        <v-btn color="primary" @click="router.back()">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </div>
    </v-card>

    <v-card>
      <v-card-text>
        <v-form ref="form" @submit.prevent="handleSubmit">
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="formData.name"
                label="اسم العميل"
                :rules="[rules.required]"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="formData.phone"
                label="رقم الهاتف"
                :hint="phoneHint"
                :error-messages="phoneError ? [phoneError] : []"
                persistent-hint
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.city" label="المدينة"></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.address" label="العنوان" rows="2"></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="formData.notes" label="ملاحظات" rows="2"></v-text-field>
            </v-col>
          </v-row>

          <v-divider class="my-4"></v-divider>

          <div class="d-flex gap-2">
            <v-btn type="submit" color="primary" :loading="loading">حفظ</v-btn>
            <v-btn @click="$router.back()">إلغاء</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>

    <!-- Duplicate-phone confirmation. The backend rejects a duplicate by
         default; this dialog lets the user explicitly opt in to a shared
         number (e.g. a family that uses one phone for multiple accounts). -->
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
            لن يتم دمج العميلين. هل تريد المتابعة وإنشاء/تعديل هذا العميل بنفس الرقم
            (مثلاً لأفراد العائلة الذين يشتركون برقم واحد)؟
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="duplicateDialog = false">إلغاء</v-btn>
          <v-btn color="warning" :loading="loading" @click="confirmDuplicateSave">
            متابعة الحفظ
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useCustomerStore } from '@/stores/customer';
import { useNotificationStore } from '@/stores/notification';
import { normalizeIraqPhone } from '@/utils/phone';

const router = useRouter();
const route = useRoute();
const notification = useNotificationStore();
const customerStore = useCustomerStore();

const form = ref(null);
const loading = ref(false);
const duplicateDialog = ref(false);
const duplicateExisting = ref(null);

const formData = ref({
  name: '',
  phone: '',
  city: '',
  address: '',
  notes: '',
});

const isEdit = computed(() => !!route.params.id);

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
};

// Live preview of how the API will store the phone for lookup. Empty input
// → no hint. Un-normalisable input → soft warning (we don't block save —
// the API still accepts it as a free-form string).
const phoneNormalised = computed(() => normalizeIraqPhone(formData.value.phone));
const phoneHint = computed(() => {
  const raw = (formData.value.phone || '').trim();
  if (!raw) return '';
  if (phoneNormalised.value && phoneNormalised.value !== raw.replace(/\D/g, '')) {
    return `سيتم البحث وحفظ هذا الرقم بصيغة موحّدة: ${phoneNormalised.value}`;
  }
  return '';
});
const phoneError = computed(() => {
  const raw = (formData.value.phone || '').trim();
  if (!raw) return '';
  if (!phoneNormalised.value) {
    return 'تنسيق رقم الهاتف غير مفهوم — تأكّد من الأرقام (يُقبل +964 أو 0…)';
  }
  return '';
});

async function performSave({ allowDuplicatePhone = false } = {}) {
  loading.value = true;
  try {
    const payload = { ...formData.value };
    if (allowDuplicatePhone) payload.allowDuplicatePhone = true;
    if (isEdit.value) {
      await customerStore.updateCustomer(route.params.id, payload);
    } else {
      await customerStore.createCustomer(payload);
    }
    duplicateDialog.value = false;
    router.push({ name: 'Customers' });
  } catch (error) {
    const data = error?.response?.data;
    if (data?.code === 'CUSTOMER_PHONE_DUPLICATE') {
      // Hand off to the confirmation dialog. The user-entered phone is
      // preserved verbatim — no silent rewrite.
      duplicateExisting.value = data.details?.existingCustomer || null;
      duplicateDialog.value = true;
      return;
    }
    notification.error(error?.response?.data?.message || error?.message || 'فشل في حفظ العميل');
  } finally {
    loading.value = false;
  }
}

const handleSubmit = async () => {
  const { valid } = await form.value.validate();
  if (!valid) return;
  await performSave();
};

const confirmDuplicateSave = () => performSave({ allowDuplicatePhone: true });

onMounted(async () => {
  if (isEdit.value) {
    loading.value = true;
    try {
      const customersList = await customerStore.fetch();
      const currentCustomer = customersList.data.find((c) => {
        return c.id === parseInt(route.params.id);
      });
      formData.value = {
        name: currentCustomer?.name,
        phone: currentCustomer?.phone,
        city: currentCustomer?.city,
        address: currentCustomer?.address,
        notes: currentCustomer?.notes,
      };
    } catch {
      // Error handled by notification
    } finally {
      loading.value = false;
    }
  }
});
</script>
