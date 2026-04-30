<template>
  <div class="page-shell">
    <PageHeader
      title="الفروع والمخازن"
      subtitle="إدارة فروع الشركة ومخازنها"
      icon="mdi-source-branch"
    />

    <v-row>
      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="me-2">mdi-source-branch</v-icon>
            <span>الفروع</span>
            <v-spacer />
            <!-- Only global admins can create branches; everyone else can
                 see the list but the button is hidden. -->
            <v-btn
              v-if="canCreateBranch"
              color="primary"
              size="small"
              prepend-icon="mdi-plus"
              @click="openCreateBranch"
            >
              فرع جديد
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-list v-if="inventoryStore.branches.length">
            <v-list-item
              v-for="b in inventoryStore.branches"
              :key="b.id"
              :disabled="!canOpenBranch(b)"
              @click="canOpenBranch(b) && openEditBranch(b)"
            >
              <v-list-item-title class="d-flex align-center flex-wrap gap-2">
                <span class="font-weight-medium">{{ b.name }}</span>
                <v-chip
                  v-if="b.defaultWarehouseId"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                >
                  افتراضي: {{ warehouseName(b.defaultWarehouseId) || '—' }}
                </v-chip>
                <v-chip
                  v-else
                  size="x-small"
                  color="warning"
                  variant="tonal"
                >
                  لا يوجد مخزن افتراضي
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="mt-1">
                <v-icon size="14" class="me-1">mdi-map-marker-outline</v-icon>
                {{ b.address || 'بدون عنوان' }}
                <span class="mx-1">·</span>
                {{ b.warehouseCount || 0 }} مخزن
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <EmptyState
            v-else
            title="لا توجد فروع"
            description="ابدأ بإضافة الفرع الأول"
            icon="mdi-source-branch"
            compact
          />
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="me-2">mdi-warehouse</v-icon>
            <span>المخازن</span>
            <v-spacer />
            <!-- Branch managers can't create warehouses — backend enforces
                 the same rule via inventory:manage. -->
            <v-btn
              v-if="canCreateWarehouse"
              color="primary"
              size="small"
              prepend-icon="mdi-plus"
              @click="openCreateWarehouse"
            >
              مخزن جديد
            </v-btn>
          </v-card-title>
          <v-divider />
          <v-list v-if="inventoryStore.warehouses.length">
            <v-list-item v-for="w in inventoryStore.warehouses" :key="w.id">
              <v-list-item-title class="d-flex align-center flex-wrap gap-2">
                <span class="font-weight-medium">{{ w.name }}</span>
                <v-chip
                  v-if="isDefaultWarehouse(w.id)"
                  size="x-small"
                  color="success"
                  variant="tonal"
                >
                  افتراضي
                </v-chip>
                <v-chip
                  v-if="w.isActive === false"
                  size="x-small"
                  color="grey"
                  variant="tonal"
                >
                  غير نشط
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="mt-1">
                <v-icon size="14" class="me-1">mdi-source-branch</v-icon>
                {{ w.branchName || '—' }}
              </v-list-item-subtitle>
              <!-- Per-item edit/delete buttons. Visibility is driven by the
                   `permissions` block the backend attaches to each row, so
                   users never see actions they can't perform — and the
                   backend re-checks anyway on the actual mutation. -->
              <template #append>
                <v-btn
                  v-if="w.permissions?.canEdit"
                  icon="mdi-pencil"
                  size="x-small"
                  variant="text"
                  @click="openEditWarehouse(w)"
                />
                <v-btn
                  v-if="w.permissions?.canDelete"
                  icon="mdi-delete"
                  size="x-small"
                  variant="text"
                  color="error"
                  @click="confirmDeleteWarehouse(w)"
                />
              </template>
            </v-list-item>
          </v-list>
          <EmptyState
            v-else
            title="لا توجد مخازن"
            description="ابدأ بإضافة المخزن الأول"
            icon="mdi-warehouse"
            compact
          />
        </v-card>
      </v-col>
    </v-row>

    <!-- Branch dialog (create + edit) -->
    <v-dialog v-model="showBranchDialog" max-width="520">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="primary">{{ branchForm.id ? 'mdi-pencil' : 'mdi-source-branch-plus' }}</v-icon>
          <span>{{ branchForm.id ? 'تعديل الفرع' : 'فرع جديد' }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <!-- Name and address are admin-editable only. Branch managers see
               them as read-only — they're allowed to change the default
               warehouse, nothing else. -->
          <v-text-field
            v-model="branchForm.name"
            label="الاسم"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-source-branch"
            class="mb-2"
            :readonly="!canEditBranchMeta"
          />
          <v-text-field
            v-model="branchForm.address"
            label="العنوان"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-map-marker-outline"
            class="mb-2"
            :readonly="!canEditBranchMeta"
          />
          <v-select
            v-if="branchForm.id"
            v-model="branchForm.defaultWarehouseId"
            :items="warehousesForBranch(branchForm.id)"
            item-title="name"
            item-value="id"
            label="المخزن الافتراضي"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-warehouse"
            clearable
            class="mb-2"
            :hint="defaultWarehouseHint"
            persistent-hint
            :readonly="!canChangeDefaultWarehouse"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="showBranchDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="savingBranch" @click="saveBranch">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Warehouse dialog (create + edit) -->
    <v-dialog v-model="showWarehouseDialog" max-width="480">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="primary">{{ warehouseForm.id ? 'mdi-pencil' : 'mdi-warehouse-plus' }}</v-icon>
          <span>{{ warehouseForm.id ? 'تعديل المخزن' : 'مخزن جديد' }}</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          <v-text-field
            v-model="warehouseForm.name"
            label="الاسم"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-warehouse"
            class="mb-2"
          />
          <v-select
            v-if="branchFeatureOn"
            v-model="warehouseForm.branchId"
            :items="branchOptionsForWarehouse"
            item-title="name"
            item-value="id"
            label="الفرع"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-source-branch"
            class="mb-2"
            :hint="warehouseBranchHint"
            persistent-hint
          />
          <v-switch
            v-if="warehouseForm.id"
            v-model="warehouseForm.isActive"
            label="نشط"
            density="comfortable"
            color="primary"
            class="mb-2"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="showWarehouseDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="savingWarehouse" @click="saveWarehouse">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Warehouse delete confirm -->
    <v-dialog v-model="showDeleteWarehouseDialog" max-width="420">
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon color="error">mdi-alert-circle</v-icon>
          <span>حذف المخزن</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="pt-4">
          هل تريد حذف المخزن <strong>"{{ deleteTarget?.name }}"</strong>؟
          إذا كان يحتوي على مخزون فسيتم تعطيله بدلًا من الحذف.
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn variant="text" @click="showDeleteWarehouseDialog = false">إلغاء</v-btn>
          <v-btn color="error" :loading="deletingWarehouse" @click="deleteWarehouseConfirmed">حذف</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';

const inventoryStore = useInventoryStore();
const authStore = useAuthStore();

const showBranchDialog = ref(false);
const showWarehouseDialog = ref(false);
const showDeleteWarehouseDialog = ref(false);
const savingBranch = ref(false);
const savingWarehouse = ref(false);
const deletingWarehouse = ref(false);
const deleteTarget = ref(null);

const branchForm = reactive({
  id: null,
  name: '',
  address: '',
  defaultWarehouseId: null,
});
const warehouseForm = reactive({
  id: null,
  name: '',
  branchId: null,
  isActive: true,
});

const branchFeatureOn = computed(() => authStore.hasFeature('multiBranch'));

// All UI gating reads from the auth store's `can()` helper plus per-row
// `permissions` blocks the API attaches to each branch/warehouse row.
// We never re-derive permissions from role here — backend re-validates
// every mutation regardless of what we send.
const canCreateBranch = computed(() => authStore.can('canCreateBranch'));
const canCreateWarehouse = computed(() => authStore.can('canCreateWarehouse'));

// Per-branch flags fall back to the global capability when the API hasn't
// attached a per-row block (e.g., during the brief moment before
// fetchBranches resolves).
const canEditBranchMetaFor = (b) =>
  b?.permissions?.canEditMeta ?? authStore.can('canEditBranchMeta');
const canChangeDefaultWarehouseFor = (b) =>
  b?.permissions?.canChangeDefaultWarehouse ??
  authStore.can('canChangeDefaultWarehouse');

// Form-level flags, computed against the branch currently being edited.
const editingBranch = computed(
  () => inventoryStore.branches.find((b) => b.id === branchForm.id) || null
);
const canEditBranchMeta = computed(() =>
  branchForm.id ? canEditBranchMetaFor(editingBranch.value) : authStore.can('canCreateBranch')
);
const canChangeDefaultWarehouse = computed(() =>
  branchForm.id
    ? canChangeDefaultWarehouseFor(editingBranch.value)
    : authStore.can('canChangeDefaultWarehouse')
);

// A branch row is "openable" when the user can edit its meta or its default
// warehouse — both flags come from the backend per-row permissions block.
const canOpenBranch = (branch) =>
  !!branch && (canEditBranchMetaFor(branch) || canChangeDefaultWarehouseFor(branch));

const warehousesForBranch = (branchId) =>
  inventoryStore.warehouses.filter(
    (w) => w.branchId === branchId && w.isActive !== false
  );

const warehouseName = (id) => inventoryStore.warehouses.find((w) => w.id === id)?.name;

const isDefaultWarehouse = (warehouseId) =>
  inventoryStore.branches.some((b) => b.defaultWarehouseId === warehouseId);

const defaultWarehouseHint = computed(() =>
  warehousesForBranch(branchForm.id).length === 0
    ? 'أنشئ مخزنًا في هذا الفرع أولاً ثم اختره كمخزن افتراضي'
    : ''
);

const openCreateBranch = () => {
  branchForm.id = null;
  branchForm.name = '';
  branchForm.address = '';
  branchForm.defaultWarehouseId = null;
  showBranchDialog.value = true;
};

const openEditBranch = (b) => {
  branchForm.id = b.id;
  branchForm.name = b.name;
  branchForm.address = b.address || '';
  branchForm.defaultWarehouseId = b.defaultWarehouseId || null;
  showBranchDialog.value = true;
};

const saveBranch = async () => {
  if (!branchForm.name) return;
  savingBranch.value = true;
  try {
    if (branchForm.id) {
      // Send only fields the user is allowed to change. Backend will still
      // reject mismatches with explicit error codes — this is just a
      // friendlier client experience.
      const payload = {};
      if (canEditBranchMeta.value) {
        payload.name = branchForm.name;
        payload.address = branchForm.address || undefined;
      }
      if (canChangeDefaultWarehouse.value) {
        payload.defaultWarehouseId = branchForm.defaultWarehouseId ?? null;
      }
      await inventoryStore.updateBranch(branchForm.id, payload);
    } else {
      await inventoryStore.createBranch({
        name: branchForm.name,
        address: branchForm.address || undefined,
      });
    }
    showBranchDialog.value = false;
  } finally {
    savingBranch.value = false;
  }
};

// Branch options shown in the warehouse dialog. branch_admin can only target
// their own branch (so the dropdown shrinks to a single, locked option). The
// backend re-checks WAREHOUSE_MOVE_FORBIDDEN.
const branchOptionsForWarehouse = computed(() => {
  if (authStore.can("canViewAllBranches")) return inventoryStore.branches;
  if (!authStore.assignedBranchId) return [];
  return inventoryStore.branches.filter(
    (b) => Number(b.id) === Number(authStore.assignedBranchId)
  );
});

const warehouseBranchHint = computed(() => {
  if (authStore.can("canViewAllBranches")) return '';
  return 'لا يمكنك نقل المخزن خارج فرعك';
});

const resetWarehouseForm = () => {
  warehouseForm.id = null;
  warehouseForm.name = '';
  warehouseForm.branchId = null;
  warehouseForm.isActive = true;
};

const openCreateWarehouse = () => {
  resetWarehouseForm();
  showWarehouseDialog.value = true;
};

const openEditWarehouse = (w) => {
  warehouseForm.id = w.id;
  warehouseForm.name = w.name;
  warehouseForm.branchId = w.branchId ?? null;
  warehouseForm.isActive = w.isActive !== false;
  showWarehouseDialog.value = true;
};

const confirmDeleteWarehouse = (w) => {
  deleteTarget.value = w;
  showDeleteWarehouseDialog.value = true;
};

const deleteWarehouseConfirmed = async () => {
  if (!deleteTarget.value) return;
  deletingWarehouse.value = true;
  try {
    await inventoryStore.deleteWarehouse(deleteTarget.value.id);
    showDeleteWarehouseDialog.value = false;
    deleteTarget.value = null;
  } finally {
    deletingWarehouse.value = false;
  }
};

const saveWarehouse = async () => {
  if (!warehouseForm.name) return;
  if (branchFeatureOn.value && !warehouseForm.branchId && !warehouseForm.id) return;
  savingWarehouse.value = true;
  try {
    if (warehouseForm.id) {
      const payload = {
        name: warehouseForm.name,
        isActive: warehouseForm.isActive,
      };
      // Only send branchId on edit when the user is allowed to move
      // warehouses across branches. Backend rejects forbidden moves with
      // WAREHOUSE_MOVE_FORBIDDEN regardless.
      if (branchFeatureOn.value && authStore.can("canViewAllBranches")) {
        payload.branchId = warehouseForm.branchId;
      }
      await inventoryStore.updateWarehouse(warehouseForm.id, payload);
    } else {
      await inventoryStore.createWarehouse({
        name: warehouseForm.name,
        branchId: branchFeatureOn.value ? warehouseForm.branchId : null,
      });
    }
    resetWarehouseForm();
    showWarehouseDialog.value = false;
  } finally {
    savingWarehouse.value = false;
  }
};

onMounted(async () => {
  await Promise.all([inventoryStore.fetchBranches(), inventoryStore.fetchWarehouses()]);
});
</script>
