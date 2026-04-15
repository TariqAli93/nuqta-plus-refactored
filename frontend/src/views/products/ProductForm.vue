<template>
  <div>
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">
          {{ isEdit ? 'تعديل منتج' : 'منتج جديد' }}
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
                label="اسم المنتج"
                :rules="[rules.required]"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="formData.sku"
                label="رمز المنتج"
                :append-inner-icon="'mdi-refresh'"
                @click:append-inner="regenerateSKU"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="formData.categoryId"
                v-model:search="categorySearch"
                :items="categories"
                item-title="name"
                item-value="id"
                label="التصنيف"
                :custom-filter="customCategoryFilter"
                clearable
                variant="outlined"
                autocomplete="off"
                @keydown="handleCategoryKeydown"
                @update:model-value="handleCategorySelect"
              >
                <template #no-data>
                  <v-list-item
                    v-if="
                      categorySearch &&
                      categorySearch.trim() &&
                      !creatingCategory &&
                      !isSearchValueInList
                    "
                    class="cursor-pointer"
                    :class="{ 'bg-primary-lighten-5': true }"
                    @click="handleCategoryEnter"
                  >
                    <v-list-item-prepend>
                      <v-icon color="primary">mdi-plus-circle</v-icon>
                    </v-list-item-prepend>
                    <v-list-item-title class="text-primary font-weight-medium">
                      اضغط Enter للإنشاء: "{{ categorySearch }}"
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item v-else-if="creatingCategory">
                    <v-list-item-prepend>
                      <v-progress-circular
                        indeterminate
                        color="primary"
                        size="20"
                        width="2"
                      ></v-progress-circular>
                    </v-list-item-prepend>
                    <v-list-item-title>
                      جاري إنشاء التصنيف "{{ categorySearch }}"...
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item v-else>
                    <v-list-item-title class="text-grey">
                      ابدأ بالكتابة للبحث أو إنشاء تصنيف جديد
                    </v-list-item-title>
                  </v-list-item>
                </template>
              </v-autocomplete>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="formData.barcode"
                label="قراءة الباركود"
                prepend-inner-icon="mdi-barcode-scan"
                autofocus
                clearable
                class="mb-4"
                @keyup.enter="handleBarcodeScan"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-if="!isEdit || isAdmin || costPriceUnlocked"
                :model-value="formatNumber(formData.costPrice)"
                :suffix="formData.currency"
                label="سعر التكلفة"
                :rules="[rules.required]"
                @update:model-value="handleCostPriceInput"
              ></v-text-field>
              <v-text-field
                v-else
                :model-value="'*******'"
                label="سعر التكلفة"
                readonly
                append-inner-icon="mdi-lock"
                hint="يتطلب صلاحيات الأدمن للعرض"
                persistent-hint
                @click:append-inner="showAdminVerifyDialog = true"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                :model-value="formatNumber(formData.sellingPrice)"
                label="سعر البيع"
                :suffix="formData.currency"
                :rules="[rules.required]"
                @update:model-value="handleSellingPriceInput"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="formData.currency"
                :items="availableCurrencies"
                label="العملة"
                :rules="[rules.required]"
                density="comfortable"
              >
                <template #prepend-inner>
                  <v-icon>mdi-currency-usd</v-icon>
                </template>
              </v-select>
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model.number="formData.stock"
                label="المخزون"
                type="number"
                :rules="[rules.required]"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model.number="formData.minStock"
                label="الحد الأدنى للمخزون"
                type="number"
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="formData.status"
                :items="statusOptions"
                label="الحالة"
                :rules="[rules.required]"
              ></v-select>
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="formData.description" label="الوصف" rows="3"></v-textarea>
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

    <!-- Admin Verification Dialog -->
    <v-dialog v-model="showAdminVerifyDialog" max-width="500" persistent>
      <v-card>
        <v-card-title class="bg-primary text-white">
          <v-icon start>mdi-shield-lock</v-icon>
          تحقق من صلاحيات الأدمن
        </v-card-title>

        <v-card-text class="pt-4">
          <v-alert type="info" variant="tonal" class="mb-4">
            لعرض سعر التكلفة، يجب إدخال بيانات مستخدم أدمن
          </v-alert>

          <v-form ref="adminForm" @submit.prevent="verifyAdmin">
            <v-text-field
              v-model="adminCredentials.username"
              label="اسم المستخدم"
              prepend-inner-icon="mdi-account"
              :rules="[rules.required]"
              :error="adminVerifyError"
            ></v-text-field>

            <v-text-field
              v-model="adminCredentials.password"
              label="كلمة المرور"
              type="password"
              prepend-inner-icon="mdi-lock"
              :rules="[rules.required]"
              :error="adminVerifyError"
              :error-messages="adminVerifyError ? adminVerifyErrorMessage : ''"
            ></v-text-field>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="adminVerifyLoading" @click="closeAdminDialog">
            إلغاء
          </v-btn>
          <v-btn
            color="primary"
            :loading="adminVerifyLoading"
            prepend-icon="mdi-check"
            @click="verifyAdmin"
          >
            تحقق
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useProductStore } from '@/stores/product';
import { useCategoryStore } from '@/stores/category';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';
import api from '@/plugins/axios';

const router = useRouter();
const route = useRoute();
const productStore = useProductStore();
const categoryStore = useCategoryStore();
const authStore = useAuthStore();
const notification = useNotificationStore();
const settingsStore = useSettingsStore();

const form = ref(null);
const adminForm = ref(null);
const loading = ref(false);
const categories = ref([]);
const categorySearch = ref('');
const creatingCategory = ref(false);

const formData = ref({
  name: '',
  sku: '',
  barcode: '',
  categoryId: null,
  description: '',
  costPrice: settingsStore.settings?.defaultCostPrice || 0,
  sellingPrice: settingsStore.settings?.defaultSellingPrice || 0,
  currency: settingsStore.settings?.defaultCurrency || 'IQD',
  stock: settingsStore.settings?.defaultStock || 0,
  minStock: settingsStore.settings?.defaultMinStock || 0,
  status: settingsStore.settings?.defaultStatus || 'available',
});

// Admin verification state
const showAdminVerifyDialog = ref(false);
const adminCredentials = ref({
  username: '',
  password: '',
});
const adminVerifyLoading = ref(false);
const adminVerifyError = ref(false);
const adminVerifyErrorMessage = ref('');
const costPriceUnlocked = ref(false);

const statusOptions = [
  { title: 'متاح', value: 'available' },
  { title: 'نفذ', value: 'out_of_stock' },
  { title: 'متوقف', value: 'discontinued' },
];

const isEdit = computed(() => !!route.params.id);
const isAdmin = computed(() => authStore.user?.role === 'admin');

// Computed property for available currencies
const availableCurrencies = computed(() => settingsStore.availableCurrencies);

const rules = {
  required: (v) => !!v || 'هذا الحقل مطلوب',
};

// دالة لتحويل النص العربي إلى SKU
const generateSKU = (name) => {
  if (!name) return '';

  // خريطة تحويل الأحرف العربية إلى إنجليزية
  const arabicToEnglish = {
    ا: 'a',
    أ: 'a',
    إ: 'a',
    آ: 'a',
    ب: 'b',
    ت: 't',
    ث: 'th',
    ج: 'j',
    ح: 'h',
    خ: 'kh',
    د: 'd',
    ذ: 'dh',
    ر: 'r',
    ز: 'z',
    س: 's',
    ش: 'sh',
    ص: 's',
    ض: 'd',
    ط: 't',
    ظ: 'z',
    ع: 'a',
    غ: 'gh',
    ف: 'f',
    ق: 'q',
    ك: 'k',
    ل: 'l',
    م: 'm',
    ن: 'n',
    ه: 'h',
    و: 'w',
    ي: 'y',
    ى: 'y',
    ة: 'h',
    ء: 'a',
  };

  let sku = name
    .toLowerCase()
    .trim()
    // تحويل الأحرف العربية
    .split('')
    .map((char) => arabicToEnglish[char] || char)
    .join('')
    // إزالة المسافات والرموز وتحويلها إلى شرطات
    .replace(/[^a-z0-9]/g, '-')
    // إزالة الشرطات المتتالية
    .replace(/-+/g, '-')
    // إزالة الشرطات من البداية والنهاية
    .replace(/^-|-$/g, '');

  return sku.toUpperCase();
};

// دالة تجديد SKU يدوياً
const regenerateSKU = () => {
  if (formData.value.name) {
    formData.value.sku = generateSKU(formData.value.name);
  }
};

const handleSubmit = async () => {
  const { valid } = await form.value.validate();
  if (!valid) return;

  loading.value = true;
  try {
    if (isEdit.value) {
      await productStore.updateProduct(route.params.id, formData.value);
    } else {
      await productStore.createProduct(formData.value);
    }
    router.push({ name: 'Products' });
  } catch (error) {
    // Error already handled by notification in store
  } finally {
    loading.value = false;
  }
};

const handleBarcodeScan = () => {
  const code = formData.value?.barcode?.trim();
  if (!code) return;
};

// فلترة مخصصة للتصنيفات
const customCategoryFilter = (item, queryText) => {
  if (!queryText) return true;
  if (!item) return false;
  // Vuetify v-autocomplete يمرر item ككائن يحتوي على raw أو مباشرة ككائن
  const category = item.raw || item;
  if (!category || !category.name) return false;
  const searchText = queryText.toLowerCase();
  const itemText = category.name.toLowerCase();
  return itemText.includes(searchText);
};

// التحقق من وجود القيمة المدخلة في القائمة
const isSearchValueInList = computed(() => {
  if (!categorySearch.value || !categorySearch.value.trim()) return false;
  const searchValue = categorySearch.value.trim().toLowerCase();
  return categories.value.some((cat) => cat.name.toLowerCase() === searchValue);
});

// معالجة اختيار التصنيف من القائمة
const handleCategorySelect = (value) => {
  if (value && typeof value === 'object' && value.name) {
    // إذا كان value كائن (عند استخدام return-object)
    formData.value.categoryId = value.id;
    categorySearch.value = value.name;
  } else if (value && typeof value === 'number') {
    // إذا كان value رقم (ID)
    const selectedCategory = categories.value.find((cat) => cat.id === value);
    if (selectedCategory) {
      categorySearch.value = selectedCategory.name;
    }
  } else if (!value) {
    // عند مسح القيمة
    categorySearch.value = '';
  }
};

// معالجة الضغط على المفاتيح في حقل التصنيف
const handleCategoryKeydown = async (event) => {
  if (event.key !== 'Enter') return;

  const searchValue = categorySearch.value?.trim();
  if (!searchValue) return;

  event.preventDefault();
  event.stopPropagation();

  // التحقق من أن القيمة غير موجودة في القائمة
  const exists = categories.value.some(
    (cat) => cat.name.toLowerCase() === searchValue.toLowerCase()
  );

  if (exists) {
    // إذا كانت موجودة، حددها
    const foundCategory = categories.value.find(
      (cat) => cat.name.toLowerCase() === searchValue.toLowerCase()
    );
    if (foundCategory) {
      formData.value.categoryId = foundCategory.id;
      // عرض اسم التصنيف في حقل البحث
      categorySearch.value = foundCategory.name;
    }
    return;
  }

  // إنشاء التصنيف الجديد
  if (creatingCategory.value) return; // منع الطلبات المتعددة

  creatingCategory.value = true;
  try {
    // إنشاء التصنيف الجديد
    const createResponse = await categoryStore.createCategory({ name: searchValue });
    // استخراج بيانات التصنيف من الاستجابة
    const newCategory = createResponse.data?.data || createResponse.data;

    if (!newCategory || !newCategory.id) {
      throw new Error('فشل إنشاء التصنيف');
    }

    // إعادة تحميل قائمة التصنيفات بالكامل من الـ store
    await categoryStore.fetchCategories();

    // تحديث القائمة المحلية من الـ store
    categories.value = Array.isArray(categoryStore.categories) ? [...categoryStore.categories] : [];

    // تحديد التصنيف الجديد
    formData.value.categoryId = newCategory.id;

    // عرض اسم التصنيف في حقل البحث بدلاً من مسحه
    categorySearch.value = newCategory.name;

    // استخدام nextTick لضمان تحديث المكون بشكل صحيح
    await nextTick();

    // التأكد من أن القيمة محددة بشكل صحيح
    if (formData.value.categoryId !== newCategory.id) {
      formData.value.categoryId = newCategory.id;
    }
  } catch (err) {
    // Error handled by notification in store
    console.error('Error creating category:', err);
  } finally {
    creatingCategory.value = false;
  }
};

// Admin verification
const verifyAdmin = async () => {
  const { valid } = await adminForm.value.validate();
  if (!valid) return;

  adminVerifyLoading.value = true;
  adminVerifyError.value = false;
  adminVerifyErrorMessage.value = '';

  try {
    const response = await api.post('/auth/login', {
      username: adminCredentials.value.username,
      password: adminCredentials.value.password,
    });

    // Check if user is admin
    if (response.data?.user?.role === 'admin') {
      costPriceUnlocked.value = true;
      notification.success('تم التحقق بنجاح');
      closeAdminDialog();
    } else {
      adminVerifyError.value = true;
      adminVerifyErrorMessage.value = 'المستخدم ليس لديه صلاحيات أدمن';
    }
  } catch (err) {
    adminVerifyError.value = true;
    adminVerifyErrorMessage.value = err.response?.data?.message || 'بيانات تسجيل الدخول غير صحيحة';
  } finally {
    adminVerifyLoading.value = false;
  }
};

const closeAdminDialog = () => {
  showAdminVerifyDialog.value = false;
  adminCredentials.value = {
    username: '',
    password: '',
  };
  adminVerifyError.value = false;
  adminVerifyErrorMessage.value = '';
  adminForm.value?.resetValidation();
};

// مراقبة تغيير اسم المنتج وتوليد SKU تلقائياً
watch(
  () => formData.value.name,
  (newName) => {
    if (newName && !isEdit.value) {
      // فقط للمنتجات الجديدة
      formData.value.sku = generateSKU(newName);
    }
  }
);

// مراقبة تغيير categoryId وتحديث categorySearch تلقائياً
watch(
  () => formData.value.categoryId,
  (newCategoryId) => {
    if (newCategoryId) {
      const selectedCategory = categories.value.find((cat) => cat.id === newCategoryId);
      if (selectedCategory && categorySearch.value !== selectedCategory.name) {
        categorySearch.value = selectedCategory.name;
      }
    } else if (!newCategoryId && categorySearch.value) {
      // عند مسح التصنيف، امسح البحث أيضاً
      categorySearch.value = '';
    }
  }
);

onMounted(async () => {
  // تحميل إعدادات العملة
  try {
    await settingsStore.fetchCurrencySettings();
    // تعيين العملة الافتراضية إذا لم تكن موجودة
    if (!formData.value.currency || !availableCurrencies.value.includes(formData.value.currency)) {
      const defaultCurrency = settingsStore.settings?.defaultCurrency || 'IQD';
      formData.value.currency = availableCurrencies.value.includes(defaultCurrency)
        ? defaultCurrency
        : availableCurrencies.value[0] || defaultCurrency;
    }
  } catch {
    // استخدام القيم الافتراضية
  }

  await categoryStore.fetchCategories();
  // تحديث القائمة المحلية من الـ store
  categories.value = Array.isArray(categoryStore.categories) ? [...categoryStore.categories] : [];

  if (isEdit.value) {
    loading.value = true;
    try {
      await productStore.fetchProduct(route.params.id);
      formData.value = { ...productStore.currentProduct };

      // التأكد من أن العملة المحددة متاحة
      if (!availableCurrencies.value.includes(formData.value.currency)) {
        const defaultCurrency = settingsStore.settings?.defaultCurrency || 'IQD';
        formData.value.currency = availableCurrencies.value.includes(defaultCurrency)
          ? defaultCurrency
          : availableCurrencies.value[0] || defaultCurrency;
      }

      // عند التعديل، عرض اسم التصنيف في حقل البحث
      if (formData.value.categoryId) {
        // استخدام nextTick لضمان تحميل categories أولاً
        await nextTick();
        const selectedCategory = categories.value.find(
          (cat) => cat.id === formData.value.categoryId
        );
        if (selectedCategory) {
          categorySearch.value = selectedCategory.name;
        }
      }
    } catch {
      // Error handled by notification
    } finally {
      loading.value = false;
    }
  }
});

// إضافة دوال تنسيق الأرقام
const formatNumber = (value) => {
  if (!value && value !== 0) return '';
  // إزالة أي فواصل موجودة
  const numStr = String(value).replace(/,/g, '');
  // التحقق من أن القيمة رقم (يدعم الأرقام العشرية)
  if (!/^\d*\.?\d*$/.test(numStr)) return value;
  // تقسيم الرقم إلى جزء صحيح وجزء عشري
  const parts = numStr.split('.');
  // تنسيق الجزء الصحيح مع الفواصل (بعد كل 3 أرقام)
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // إرجاع الرقم المنسق
  return parts.join('.');
};

const parseNumber = (value) => {
  if (!value) return 0;
  // إزالة الفواصل وتحويل إلى رقم
  const numStr = String(value).replace(/,/g, '');
  const num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
};

const handleCostPriceInput = (value) => {
  const num = parseNumber(value);
  formData.value.costPrice = num;
};

const handleSellingPriceInput = (value) => {
  const num = parseNumber(value);
  formData.value.sellingPrice = num;
};
</script>
