<template>
  <div class="space-y-6">
    <!-- 🔹 شريط الأدوات العلوي -->
    <v-card class="mb-4">
      <div class="flex justify-space-between items-center pa-3">
        <div class="text-h6 font-semibold text-primary">إدارة الصلاحيات</div>
        <v-btn color="primary" prepend-icon="mdi-plus" class="rounded-lg" @click="openForm()">
          صلاحية جديدة
        </v-btn>
      </div>
    </v-card>

    <!-- 🔹 البحث -->
    <v-card class="mb-4">
      <v-card-text>
        <v-text-field
          v-model="search"
          label="بحث بالاسم أو المورد"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="comfortable"
          clearable
          hide-details
          @input="fetch"
        />
      </v-card-text>
    </v-card>

    <!-- 🔹 جدول الصلاحيات -->
    <v-card>
      <v-data-table
        :headers="headers"
        :items="store.list"
        :loading="store.loading"
        density="comfortable"
        hover
        class="elevation-0"
        :search="search"
      >
        <template #loading>
          <v-skeleton-loader type="table"></v-skeleton-loader>
        </template>

        <!-- 🔸 عمود الإجراء -->
        <template #[`item.action`]="{ item }">
          <v-chip color="primary" variant="flat" size="small">
            {{ translateAction(item.action) }}
          </v-chip>
        </template>

        <!-- 🔸 عمود الوصف -->
        <template #[`item.description`]="{ item }">
          <span class="text-gray-600 dark:text-gray-300 text-sm">
            {{ item.description || '—' }}
          </span>
        </template>

        <template #[`item.name`]="{ item }">
          <span>{{ translatePermission(item.name) }}</span>
        </template>

        <!-- 🔸 عمود العمليات -->
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-center gap-2">
            <v-btn icon size="small" variant="text" color="primary" @click="openForm(item)">
              <v-icon>mdi-pencil</v-icon>
            </v-btn>
            <v-btn icon size="small" variant="text" color="error" @click="remove(item)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- 🔹 نافذة إنشاء صلاحيات متعددة -->
    <v-dialog v-model="showForm" max-width="600">
      <v-card elevation="12" rounded="xl" class="overflow-hidden">
        <v-card-title class="bg-secondary text-white"> صلاحيات جديدة </v-card-title>

        <v-card-text class="py-6 px-6">
          <v-form ref="formRef" class="space-y-4" @submit.prevent="save">
            <!-- ✅ اختيار المورد -->
            <v-select
              v-model="form.resource"
              :items="Object.keys(permissionsList)"
              label="المورد (Resource)"
              variant="outlined"
              density="comfortable"
              required
            />

            <!-- ✅ اختيار متعدد للإجراءات -->
            <v-select
              v-model="form.actions"
              :items="actions"
              label="الإجراءات (Actions)"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              chips
              multiple
              required
            />

            <v-textarea
              v-model="form.description"
              label="الوصف (اختياري)"
              auto-grow
              variant="outlined"
              density="comfortable"
              rows="2"
            />
          </v-form>

          <!-- 🔹 عرض المعاينة -->
          <div v-if="form.resource && form.actions.length" class="mt-4 text-sm text-gray-700">
            <div class="font-semibold mb-1">المعاينة:</div>
            <ul>
              <li v-for="action in form.actions" :key="action">
                {{ translateAction(action) }} {{ translateResource(form.resource) }}
                <span class="text-gray-400 text-xs">({{ form.resource }}:{{ action }})</span>
              </li>
            </ul>
          </div>
        </v-card-text>

        <v-divider></v-divider>

        <v-card-actions class="flex justify-end gap-2 px-4 py-3">
          <v-btn color="primary" variant="elevated" @click="save">حفظ</v-btn>
          <v-spacer />
          <v-btn variant="text" color="grey" @click="closeForm">إلغاء</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model="deleteDialog"
      title="حذف الصلاحية"
      :message="`هل أنت متأكد من حذف ${selectedItem?.name}؟`"
      type="error"
      confirm-text="حذف"
      cancel-text="إلغاء"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { usePermissionsStore } from '@/stores/permissions';
import { useNotificationStore } from '@/stores/notification';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

const store = usePermissionsStore();
const notification = useNotificationStore();

// Delete dialog state
const deleteDialog = ref(false);
const selectedItem = ref(null);

const showForm = ref(false);
const formRef = ref(null);
const search = ref('');

function translatePermission(name) {
  if (!name) return '—';

  // تقسيم النص إلى جزأين: resource و action
  const [resource, action] = name.split(':');

  // ترجمة الموارد (resources)
  const resourceMap = {
    users: 'المستخدمين',
    roles: 'الأدوار',
    permissions: 'الصلاحيات',
    customers: 'العملاء',
    products: 'المنتجات',
    sales: 'المبيعات',
    categories: 'الفئات',
    settings: 'الإعدادات',
    reports: 'التقارير',
    dashboard: 'لوحة التحكم',
  };

  // ترجمة الأفعال (actions)
  const actionMap = {
    create: 'إنشاء',
    read: 'عرض',
    update: 'تعديل',
    delete: 'حذف',
    manage: 'إدارة',
  };

  // إنشاء الترجمة العربية
  const resourceText = resourceMap[resource] || resource;
  const actionText = actionMap[action] || action;

  return `${actionText} ${resourceText}`;
}

// ✅ جدول الأعمدة
const headers = [
  { title: 'المعرف', key: 'id', align: 'center' },
  { title: 'الاسم', key: 'name' },
  { title: 'المورد', key: 'resource' },
  { title: 'الإجراء', key: 'action' },
  { title: 'الوصف', key: 'description' },
  { title: 'خيارات', key: 'actions', sortable: false, align: 'center' },
];

const actions = [
  { title: 'إنشاء (create)', value: 'create' },
  { title: 'عرض (read)', value: 'read' },
  { title: 'تعديل (update)', value: 'update' },
  { title: 'حذف (delete)', value: 'delete' },
  { title: 'إدارة (manage)', value: 'manage' },
];

const permissionsList = {
  users: ['manage', 'create', 'read', 'update', 'delete'],
  permissions: ['manage', 'create', 'read', 'update', 'delete'],
  roles: ['manage', 'create', 'read', 'update', 'delete'],
  customers: ['manage', 'create', 'read', 'update', 'delete'],
  products: ['manage', 'create', 'read', 'update', 'delete'],
  sales: ['manage', 'create', 'read', 'update', 'delete'],
  categories: ['manage', 'create', 'read', 'update', 'delete'],
  settings: ['manage', 'create', 'read', 'update', 'delete'],
};

// 🔸 الترجمة العربية
const translateResource = (r) =>
  ({
    users: 'المستخدمين',
    permissions: 'الصلاحيات',
    roles: 'الأدوار',
    customers: 'العملاء',
    products: 'المنتجات',
    sales: 'المبيعات',
    categories: 'الفئات',
    settings: 'الإعدادات',
    reports: 'التقارير',
    dashboard: 'لوحة التحكم',
  })[r] || r;

const translateAction = (a) =>
  ({
    create: 'إنشاء',
    read: 'عرض',
    update: 'تعديل',
    delete: 'حذف',
    manage: 'إدارة',
  })[a] || a;

// ✅ نموذج الصلاحية
const form = reactive({
  resource: '',
  actions: [],
  description: '',
});

function openForm() {
  form.resource = '';
  form.actions = [];
  form.description = '';
  showForm.value = true;
}

function closeForm() {
  form.resource = '';
  form.actions = [];
  form.description = '';
  showForm.value = false;
}

// 🔹 حفظ / تعديل
async function save() {
  if (!form.resource || form.actions.length === 0) return;

  // ✅ إنشاء صلاحيات متعددة دفعة واحدة
  const permissionsToCreate = form.actions.map((action) => ({
    name: `${form.resource}:${action}`,
    resource: form.resource,
    action,
    description:
      form.description || `${translateAction(action)} ${translateResource(form.resource)}`,
  }));

  for (const p of permissionsToCreate) {
    await store.create(p);
  }

  closeForm();
  await store.fetch();
}

// 🔹 حذف
async function remove(item) {
  selectedItem.value = item;
  deleteDialog.value = true;
}

async function confirmDelete() {
  if (selectedItem.value) {
    await store.remove(selectedItem.value.id);
    notification.success('تم الحذف بنجاح');
    await store.fetch(search.value);
    selectedItem.value = null;
  }
}

// 🔹 تحميل البيانات
async function fetch() {
  await store.fetch(search.value);
}
onMounted(fetch);
</script>
