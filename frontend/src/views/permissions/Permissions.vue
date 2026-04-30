<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة الصلاحيات"
      subtitle="تعريف الصلاحيات حسب المورد والإجراء"
      icon="mdi-shield-key"
    >
      <v-btn color="primary" prepend-icon="mdi-plus" size="default" @click="openForm()">
        صلاحية جديدة
      </v-btn>
    </PageHeader>

    <v-card class="page-section filter-toolbar">
      <v-text-field
        v-model="search"
        label="بحث بالاسم أو المورد"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        @input="fetch"
      />
    </v-card>

    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة الصلاحيات
        </span>
      </div>
      <v-data-table
        :headers="headers"
        :items="store.list"
        :loading="store.loading"
        :search="search"
        density="comfortable"
        hide-default-footer
        items-per-page="50"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد صلاحيات"
            description="ابدأ بإنشاء صلاحية جديدة"
            icon="mdi-shield-key-outline"
            compact
          />
        </template>
        <template #[`item.action`]="{ item }">
          <v-chip color="primary" variant="tonal" size="small">
            {{ translateAction(item.action) }}
          </v-chip>
        </template>
        <template #[`item.description`]="{ item }">
          <span class="text-body-2 text-medium-emphasis">
            {{ item.description || '—' }}
          </span>
        </template>
        <template #[`item.name`]="{ item }">
          <span>{{ translatePermission(item.name) }}</span>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            color="primary"
            title="تعديل"
            @click="openForm(item)"
          >
            <v-icon size="20">mdi-pencil</v-icon>
          </v-btn>
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="حذف"
            @click="remove(item)"
          >
            <v-icon size="20">mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create permissions dialog -->
    <v-dialog v-model="showForm" max-width="600">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>mdi-shield-plus</v-icon>
          <span>صلاحيات جديدة</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-form ref="formRef" @submit.prevent="save">
            <v-select
              v-model="form.resource"
              :items="Object.keys(permissionsList)"
              label="المورد (Resource)"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-folder-shield"
              class="mb-3"
              required
            />
            <v-select
              v-model="form.actions"
              :items="actions"
              label="الإجراءات (Actions)"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-cog"
              chips
              multiple
              required
              class="mb-3"
            />
            <v-textarea
              v-model="form.description"
              label="الوصف (اختياري)"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-text"
              rows="2"
              auto-grow
            />
          </v-form>

          <div v-if="form.resource && form.actions.length" class="mt-4">
            <div class="text-subtitle-2 font-weight-semibold mb-2">المعاينة:</div>
            <div class="d-flex flex-wrap gap-2">
              <v-chip
                v-for="action in form.actions"
                :key="action"
                color="primary"
                variant="tonal"
                size="small"
              >
                {{ translateAction(action) }} {{ translateResource(form.resource) }}
                <span class="text-caption text-medium-emphasis ms-1">
                  ({{ form.resource }}:{{ action }})
                </span>
              </v-chip>
            </div>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeForm">إلغاء</v-btn>
          <v-btn color="primary" prepend-icon="mdi-content-save" @click="save">
            حفظ
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

const store = usePermissionsStore();
const notification = useNotificationStore();

const deleteDialog = ref(false);
const selectedItem = ref(null);

const showForm = ref(false);
const formRef = ref(null);
const search = ref('');

function translatePermission(name) {
  if (!name) return '—';
  const [resource, action] = name.split(':');
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
  const actionMap = {
    create: 'إنشاء',
    read: 'عرض',
    update: 'تعديل',
    delete: 'حذف',
    manage: 'إدارة',
  };
  const resourceText = resourceMap[resource] || resource;
  const actionText = actionMap[action] || action;
  return `${actionText} ${resourceText}`;
}

const headers = [
  { title: 'المعرف', key: 'id', align: 'center' },
  { title: 'الاسم', key: 'name' },
  { title: 'المورد', key: 'resource' },
  { title: 'الإجراء', key: 'action' },
  { title: 'الوصف', key: 'description' },
  { title: 'إجراءات', key: 'actions', sortable: false, align: 'center' },
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

async function save() {
  if (!form.resource || form.actions.length === 0) return;
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

async function fetch() {
  await store.fetch(search.value);
}
onMounted(fetch);
</script>
