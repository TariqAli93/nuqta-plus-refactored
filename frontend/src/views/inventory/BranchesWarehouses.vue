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
            <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="showBranchDialog = true">
              فرع جديد
            </v-btn>
          </v-card-title>
          <v-list>
            <v-list-item v-for="b in inventoryStore.branches" :key="b.id">
              <v-list-item-title>{{ b.name }}</v-list-item-title>
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
              <v-list-item-title>{{ w.name }}</v-list-item-title>
              <v-list-item-subtitle>
                الفرع: {{ w.branchName || '—' }} — {{ w.isActive ? 'نشط' : 'غير نشط' }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <!-- Branch dialog -->
    <v-dialog v-model="showBranchDialog" max-width="480">
      <v-card>
        <v-card-title>فرع جديد</v-card-title>
        <v-card-text>
          <v-text-field v-model="branchForm.name" label="الاسم" density="comfortable" class="mb-2" />
          <v-text-field v-model="branchForm.address" label="العنوان" density="comfortable" class="mb-2" />
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
import { onMounted, reactive, ref } from 'vue';
import { useInventoryStore } from '@/stores/inventory';

const inventoryStore = useInventoryStore();

const showBranchDialog = ref(false);
const showWarehouseDialog = ref(false);
const savingBranch = ref(false);
const savingWarehouse = ref(false);

const branchForm = reactive({ name: '', address: '' });
const warehouseForm = reactive({ name: '', branchId: null });

const saveBranch = async () => {
  if (!branchForm.name) return;
  savingBranch.value = true;
  try {
    await inventoryStore.createBranch({
      name: branchForm.name,
      address: branchForm.address || undefined,
    });
    branchForm.name = '';
    branchForm.address = '';
    showBranchDialog.value = false;
  } finally {
    savingBranch.value = false;
  }
};

const saveWarehouse = async () => {
  if (!warehouseForm.name || !warehouseForm.branchId) return;
  savingWarehouse.value = true;
  try {
    await inventoryStore.createWarehouse({
      name: warehouseForm.name,
      branchId: warehouseForm.branchId,
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
