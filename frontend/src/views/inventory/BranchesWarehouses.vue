<template>
  <div>
    <v-card class="mb-4">
      <div class="flex items-center justify-space-between pa-3">
        <div class="font-semibold text-h6 text-primary">الفروع والمخازن</div>
      </div>
    </v-card>

    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="flex items-center justify-space-between">
            <span>الفروع</span>
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
          <v-list>
            <v-list-item
              v-for="b in inventoryStore.branches"
              :key="b.id"
              :disabled="!canOpenBranch(b)"
              @click="canOpenBranch(b) && openEditBranch(b)"
            >
              <v-list-item-title>
                {{ b.name }}
                <v-chip
                  v-if="b.defaultWarehouseId"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="ml-2"
                >
                  افتراضي: {{ warehouseName(b.defaultWarehouseId) || '—' }}
                </v-chip>
                <v-chip
                  v-else
                  size="x-small"
                  color="warning"
                  variant="tonal"
                  class="ml-2"
                >
                  لا يوجد مخزن افتراضي
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ b.address || 'بدون عنوان' }} — {{ b.warehouseCount || 0 }} مخزن
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="flex items-center justify-space-between">
            <span>المخازن</span>
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
          <v-list>
            <v-list-item v-for="w in inventoryStore.warehouses" :key="w.id">
              <v-list-item-title>
                {{ w.name }}
                <v-chip
                  v-if="isDefaultWarehouse(w.id)"
                  size="x-small"
                  color="success"
                  variant="tonal"
                  class="ml-2"
                >
                  افتراضي
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                الفرع: {{ w.branchName || '—' }} — {{ w.isActive ? 'نشط' : 'غير نشط' }}
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
        </v-card>
      </v-col>
    </v-row>

    <!-- Branch dialog (create + edit) -->
    <v-dialog v-model="showBranchDialog" max-width="520">
      <v-card>
        <v-card-title>{{ branchForm.id ? 'تعديل الفرع' : 'فرع جديد' }}</v-card-title>
        <v-card-text>
          <!-- Name and address are admin-editable only. Branch managers see
               them as read-only — they're allowed to change the default
               warehouse, nothing else. -->
          <v-text-field
            v-model="branchForm.name"
            label="الاسم"
            density="comfortable"
            class="mb-2"
            :readonly="!canEditBranchMeta"
          />
          <v-text-field
            v-model="branchForm.address"
            label="العنوان"
            density="comfortable"
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
            density="comfortable"
            clearable
            class="mb-2"
            :hint="defaultWarehouseHint"
            persistent-hint
            :readonly="!canChangeDefaultWarehouse"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showBranchDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="savingBranch" @click="saveBranch">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Warehouse dialog (create + edit) -->
    <v-dialog v-model="showWarehouseDialog" max-width="480">
      <v-card>
        <v-card-title>{{ warehouseForm.id ? 'تعديل المخزن' : 'مخزن جديد' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="warehouseForm.name" label="الاسم" density="comfortable" class="mb-2" />
          <v-select
            v-if="branchFeatureOn"
            v-model="warehouseForm.branchId"
            :items="branchOptionsForWarehouse"
            item-title="name"
            item-value="id"
            label="الفرع"
            density="comfortable"
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
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showWarehouseDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="savingWarehouse" @click="saveWarehouse">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Warehouse delete confirm -->
    <v-dialog v-model="showDeleteWarehouseDialog" max-width="420">
      <v-card>
        <v-card-title>حذف المخزن</v-card-title>
        <v-card-text>
          هل تريد حذف المخزن "{{ deleteTarget?.name }}"؟
          إذا كان يحتوي على مخزون فسيتم تعطيله بدلًا من الحذف.
        </v-card-text>
        <v-card-actions>
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

// All UI gating reads from `authStore.capabilities` (the global flags from
// the backend) plus per-row `permissions` blocks the API attaches to each
// branch/warehouse row. We never re-derive permissions from role here —
// backend re-validates every mutation regardless of what we send.
const capabilities = computed(() => authStore.capabilities || {});
const canCreateBranch = computed(() => capabilities.value.canCreateBranch === true);
const canCreateWarehouse = computed(() => capabilities.value.canCreateWarehouse === true);

// Per-branch flags fall back to the global capability when the API hasn't
// attached a per-row block (e.g., during the brief moment before
// fetchBranches resolves).
const canEditBranchMetaFor = (b) =>
  b?.permissions?.canEditMeta ?? (capabilities.value.canEditBranchMeta === true);
const canChangeDefaultWarehouseFor = (b) =>
  b?.permissions?.canChangeDefaultWarehouse ??
  (capabilities.value.canChangeDefaultWarehouse === true);

// Form-level flags, computed against the branch currently being edited.
const editingBranch = computed(
  () => inventoryStore.branches.find((b) => b.id === branchForm.id) || null
);
const canEditBranchMeta = computed(() =>
  branchForm.id ? canEditBranchMetaFor(editingBranch.value) : capabilities.value.canCreateBranch === true
);
const canChangeDefaultWarehouse = computed(() =>
  branchForm.id
    ? canChangeDefaultWarehouseFor(editingBranch.value)
    : capabilities.value.canChangeDefaultWarehouse === true
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
  if (capabilities.value.canViewAllBranches) return inventoryStore.branches;
  if (!authStore.assignedBranchId) return [];
  return inventoryStore.branches.filter(
    (b) => Number(b.id) === Number(authStore.assignedBranchId)
  );
});

const warehouseBranchHint = computed(() => {
  if (capabilities.value.canViewAllBranches) return '';
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
      if (branchFeatureOn.value && capabilities.value.canViewAllBranches) {
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
