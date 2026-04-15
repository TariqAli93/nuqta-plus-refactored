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
              <v-text-field v-model="formData.phone" label="رقم الهاتف"></v-text-field>
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
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useCustomerStore } from '@/stores/customer';
import { useNotificationStore } from '@/stores/notification';

const router = useRouter();
const route = useRoute();
const notification = useNotificationStore();
const customerStore = useCustomerStore();

const form = ref(null);
const loading = ref(false);

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

const handleSubmit = async () => {
  const { valid } = await form.value.validate();
  if (!valid) return;

  loading.value = true;
  try {
    if (isEdit.value) {
      await customerStore.updateCustomer(route.params.id, formData.value);
    } else {
      await customerStore.createCustomer(formData.value);
    }
    router.push({ name: 'Customers' });
  } catch (error) {
    notification.error(error.message);
  } finally {
    loading.value = false;
  }
};

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
