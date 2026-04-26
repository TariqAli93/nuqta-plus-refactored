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
            <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openCreateBranch">
              فرع جديد
            </v-btn>
          </v-card-title>
          <v-list>
            <v-list-item
              v-for="b in inventoryStore.branches"
              :key="b.id"
              @click="openEditBranch(b)"
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
            <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="showWarehouseDialog = true">
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
          <v-text-field v-model="branchForm.name" label="الاسم" density="comfortable" class="mb-2" />
          <v-text-field v-model="branchForm.address" label="العنوان" density="comfortable" class="mb-2" />
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
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showBranchDialog = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="savingBranch" @click="saveBranch">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Warehouse dialog -->
    <v-dialog v-model="showWarehouseDialog" max-width="480">
      <v-card>
        <v-card-title>مخزن جديد</v-card-title>
        <v-card-text>
          <v-text-field v-model="warehouseForm.name" label="الاسم" density="comfortable" class="mb-2" />
          <v-select
            v-if="branchFeatureOn"
            v-model="warehouseForm.branchId"
            :items="inventoryStore.branches"
            item-title="name"
            item-value="id"
            label="الفرع"
            density="comfortable"
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
const savingBranch = ref(false);
const savingWarehouse = ref(false);

const branchForm = reactive({
  id: null,
  name: '',
  address: '',
  defaultWarehouseId: null,
});
const warehouseForm = reactive({ name: '', branchId: null });

const branchFeatureOn = computed(() => authStore.featureFlags?.multiBranch !== false);

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
      await inventoryStore.updateBranch(branchForm.id, {
        name: branchForm.name,
        address: branchForm.address || undefined,
        defaultWarehouseId: branchForm.defaultWarehouseId ?? null,
      });
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

const saveWarehouse = async () => {
  if (!warehouseForm.name) return;
  if (branchFeatureOn.value && !warehouseForm.branchId) return;
  savingWarehouse.value = true;
  try {
    await inventoryStore.createWarehouse({
      name: warehouseForm.name,
      branchId: branchFeatureOn.value ? warehouseForm.branchId : null,
    });
    warehouseForm.name = '';
    warehouseForm.branchId = null;
    showWarehouseDialog.value = false;
  } finally {
    savingWarehouse.value = false;
  }
};

onMounted(async () => {
  await Promise.all([inventoryStore.fetchBranches(), inventoryStore.fetchWarehouses()]);
});
</script>
