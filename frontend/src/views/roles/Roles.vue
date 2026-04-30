<template>
  <div class="page-shell">
    <PageHeader
      title="إدارة الأدوار"
      subtitle="تعريف الأدوار وتعيين الصلاحيات"
      icon="mdi-shield-account"
    >
      <v-btn color="primary" prepend-icon="mdi-plus" size="default" @click="openForm()">
        دور جديد
      </v-btn>
    </PageHeader>

    <v-card class="page-section">
      <div class="section-title">
        <span class="section-title__label">
          <v-icon size="20" color="primary">mdi-format-list-bulleted</v-icon>
          قائمة الأدوار
        </span>
      </div>
      <v-data-table
        :headers="headers"
        :items="store.list"
        :loading="store.loading"
        density="comfortable"
        hide-default-footer
        items-per-page="50"
      >
        <template #loading>
          <TableSkeleton :rows="5" :columns="headers.length" />
        </template>
        <template #no-data>
          <EmptyState
            title="لا توجد أدوار"
            description="ابدأ بإنشاء الدور الأول"
            icon="mdi-shield-account-outline"
            compact
          />
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-pencil"
            size="small"
            color="primary"
            variant="text"
            title="تعديل"
            @click="openForm(item)"
          />
          <v-btn
            icon="mdi-shield-check"
            size="small"
            color="info"
            variant="text"
            title="تعيين الصلاحيات"
            @click="openAssign(item)"
          />
          <v-btn
            icon="mdi-delete"
            size="small"
            color="error"
            variant="text"
            title="حذف"
            @click="remove(item)"
          />
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/edit role -->
    <v-dialog v-model="showForm" max-width="520">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>{{ form.id ? 'mdi-pencil' : 'mdi-shield-plus' }}</v-icon>
          <span>{{ form.id ? 'تعديل دور' : 'دور جديد' }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-text-field
            v-model="form.name"
            label="اسم الدور"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-shield-account"
            class="mb-2"
          />
          <v-textarea
            v-model="form.description"
            label="الوصف (اختياري)"
            variant="outlined"
            rows="2"
            density="comfortable"
            prepend-inner-icon="mdi-text"
            auto-grow
          />
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showForm = false">إلغاء</v-btn>
          <v-btn color="primary" prepend-icon="mdi-content-save" :loading="saving" @click="save">
            حفظ
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Assign permissions -->
    <v-dialog v-model="showAssign" max-width="900">
      <v-card>
        <v-card-title class="dialog-title">
          <v-icon>mdi-shield-check</v-icon>
          <span>تعيين الصلاحيات: {{ activeRole?.name }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-text-field
            v-model="search"
            label="بحث في الصلاحيات"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="comfortable"
            clearable
            hide-details
            class="mb-4"
          />

          <div v-if="loadingPerms" class="loading-state loading-state--compact">
            <v-progress-circular indeterminate color="primary" size="40" />
            <div class="text-body-2 text-medium-emphasis">جاري تحميل الصلاحيات…</div>
          </div>

          <v-row v-else>
            <v-col cols="12" md="6">
              <v-card variant="outlined">
                <div class="section-title">
                  <span class="section-title__label">
                    <v-icon size="20" color="primary">mdi-shield-plus-outline</v-icon>
                    الصلاحيات المتاحة
                  </span>
                </div>
                <v-card-text>
                  <v-expansion-panels multiple variant="accordion">
                    <v-expansion-panel
                      v-for="(group, resource) in filteredGroupedPermissions"
                      :key="resource"
                    >
                      <v-expansion-panel-title>
                        <v-icon start color="primary">mdi-folder-shield</v-icon>
                        {{ translateResource(resource) }}
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <v-list>
                          <v-list-item v-for="perm in group" :key="perm.id">
                            <v-checkbox
                              v-model="selectedPermIds"
                              :value="perm.id"
                              :label="translatePermission(perm.name)"
                              hide-details
                              density="comfortable"
                            />
                          </v-list-item>
                        </v-list>
                      </v-expansion-panel-text>
                    </v-expansion-panel>
                  </v-expansion-panels>
                </v-card-text>
              </v-card>
            </v-col>

            <v-col cols="12" md="6">
              <v-card variant="outlined">
                <div class="section-title">
                  <span class="section-title__label">
                    <v-icon size="20" color="primary">mdi-shield-outline</v-icon>
                    الصلاحيات الحالية
                  </span>
                </div>
                <v-card-text>
                  <v-expansion-panels multiple variant="accordion">
                    <v-expansion-panel
                      v-for="(group, resource) in groupedRolePermissions"
                      :key="resource"
                    >
                      <v-expansion-panel-title>
                        <v-icon start color="primary">mdi-folder-shield</v-icon>
                        {{ translateResource(resource) }}
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <div class="d-flex flex-wrap gap-2">
                          <v-chip
                            v-for="perm in group"
                            :key="perm.id"
                            :color="getActionColor(perm.name)"
                            variant="tonal"
                            size="small"
                          >
                            {{ translatePermission(perm.name) }}
                          </v-chip>
                        </div>
                      </v-expansion-panel-text>
                    </v-expansion-panel>
                  </v-expansion-panels>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showAssign = false">إلغاء</v-btn>
          <v-btn color="primary" prepend-icon="mdi-check" :loading="assigning" @click="assign">
            تعيين
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="deleteDialog"
      title="حذف الدور"
      :message="`هل أنت متأكد من حذف ${selectedItem?.name}؟`"
      type="error"
      confirm-text="حذف"
      cancel-text="إلغاء"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRolesStore } from '@/stores/roles';
import { usePermissionsStore } from '@/stores/permissions';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';

const store = useRolesStore();
const permStore = usePermissionsStore();

const deleteDialog = ref(false);
const selectedItem = ref(null);

const showForm = ref(false);
const showAssign = ref(false);
const saving = ref(false);
const assigning = ref(false);
const loadingPerms = ref(false);
const activeRole = ref(null);
const search = ref('');
const snackbar = reactive({ show: false, text: '', color: 'success' });

const form = reactive({ id: null, name: '', description: '' });

const permissions = ref([]);
const rolePermissions = ref([]);
const selectedPermIds = ref([]);

const headers = [
  { title: 'المعرف', key: 'id', align: 'center' },
  { title: 'الاسم', key: 'name' },
  { title: 'الوصف', key: 'description' },
  { title: 'إجراءات', key: 'actions', align: 'center', sortable: false },
];

function openForm(item) {
  if (item) Object.assign(form, item);
  else Object.assign(form, { id: null, name: '', description: '' });
  showForm.value = true;
}

async function save() {
  try {
    saving.value = true;
    if (form.id) await store.update(form.id, form);
    else await store.create(form);
    snackbar.text = 'تم حفظ الدور بنجاح';
    snackbar.color = 'success';
    snackbar.show = true;
    showForm.value = false;
    await store.fetch();
  } catch {
    snackbar.text = 'حدث خطأ أثناء الحفظ';
    snackbar.color = 'error';
    snackbar.show = true;
  } finally {
    saving.value = false;
  }
}

async function remove(item) {
  selectedItem.value = item;
  deleteDialog.value = true;
}

async function confirmDelete() {
  if (selectedItem.value) {
    await store.remove(selectedItem.value.id);
    snackbar.text = 'تم الحذف بنجاح';
    snackbar.color = 'success';
    snackbar.show = true;
    await store.fetch();
    selectedItem.value = null;
  }
}

async function openAssign(role) {
  activeRole.value = role;
  showAssign.value = true;
  loadingPerms.value = true;
  await permStore.fetch();
  permissions.value = permStore.list;
  rolePermissions.value = await store.getPermissions(role.id);
  selectedPermIds.value = rolePermissions.value.map((p) => p.id);
  loadingPerms.value = false;
}

async function assign() {
  assigning.value = true;
  await store.assignPermissions(activeRole.value.id, selectedPermIds.value);
  rolePermissions.value = await store.getPermissions(activeRole.value.id);
  snackbar.text = 'تم تحديث صلاحيات الدور';
  snackbar.color = 'success';
  snackbar.show = true;
  assigning.value = false;
}

function translatePermission(name) {
  if (!name) return '';
  const [action, resource] = name.split(':');
  const actionsMap = {
    create: 'إنشاء',
    read: 'قراءة',
    update: 'تعديل',
    delete: 'حذف',
    manage: 'إدارة',
    view: 'عرض',
  };
  return `${actionsMap[action] || action} ${translateResource(resource)}`;
}

function translateResource(res) {
  if (!res) return '';
  const normalized = res.toLowerCase().replace(/[-_]/g, '');
  const map = {
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
    view: 'عرض',
  };
  return map[normalized] || res;
}

function getActionColor(name) {
  const [action] = name.split(':');
  return (
    {
      create: 'success',
      read: 'info',
      update: 'warning',
      delete: 'error',
      manage: 'secondary',
    }[action] || 'grey'
  );
}

const groupedPermissions = computed(() => {
  const grouped = {};
  for (const perm of permissions.value) {
    const [resource] = perm.name.split(':');
    if (!grouped[resource]) grouped[resource] = [];
    grouped[resource].push(perm);
  }
  return grouped;
});

const filteredGroupedPermissions = computed(() => {
  if (!search.value) return groupedPermissions.value;
  const term = search.value.toLowerCase();
  const filtered = {};
  for (const [resource, perms] of Object.entries(groupedPermissions.value)) {
    const matches = perms.filter((p) =>
      translatePermission(p.name).toLowerCase().includes(term)
    );
    if (matches.length) filtered[resource] = matches;
  }
  return filtered;
});

const groupedRolePermissions = computed(() => {
  const grouped = {};
  for (const perm of rolePermissions.value) {
    const [resource] = perm.name.split(':');
    if (!grouped[resource]) grouped[resource] = [];
    grouped[resource].push(perm);
  }
  return grouped;
});

onMounted(async () => {
  await store.fetch();
});
</script>
