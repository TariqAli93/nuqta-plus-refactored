import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

const LS_BRANCH = 'nuqta-selected-branch';
const LS_WAREHOUSE = 'nuqta-selected-warehouse';

function readLS(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLS(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

export const useInventoryStore = defineStore('inventory', {
  state: () => ({
    branches: [],
    warehouses: [],
    selectedBranchId: readLS(LS_BRANCH),
    selectedWarehouseId: readLS(LS_WAREHOUSE),
    stock: [],
    movements: [],
    movementsPagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    lowStock: [],
    loading: false,
  }),

  getters: {
    selectedBranch(state) {
      return state.branches.find((b) => b.id === state.selectedBranchId) || null;
    },
    selectedWarehouse(state) {
      return state.warehouses.find((w) => w.id === state.selectedWarehouseId) || null;
    },
    warehousesForBranch(state) {
      if (!state.selectedBranchId) return state.warehouses;
      return state.warehouses.filter((w) => w.branchId === state.selectedBranchId);
    },
    lowStockCount: (state) => state.lowStock.length,
  },

  actions: {
    setBranch(id) {
      this.selectedBranchId = id || null;
      writeLS(LS_BRANCH, this.selectedBranchId);
      // If the chosen warehouse is no longer in the branch, reset it.
      if (
        this.selectedWarehouseId &&
        !this.warehouses.some(
          (w) => w.id === this.selectedWarehouseId && w.branchId === this.selectedBranchId
        )
      ) {
        this.setWarehouse(null);
      }
    },
    setWarehouse(id) {
      this.selectedWarehouseId = id || null;
      writeLS(LS_WAREHOUSE, this.selectedWarehouseId);
    },

    async fetchBranches() {
      const response = await api.get('/branches');
      this.branches = response?.data || [];
      if (!this.selectedBranchId && this.branches.length) {
        this.setBranch(this.branches[0].id);
      }
      return this.branches;
    },

    async fetchWarehouses(branchId) {
      const params = branchId ? { branchId, activeOnly: true } : { activeOnly: true };
      const response = await api.get('/warehouses', { params });
      this.warehouses = response?.data || [];
      if (!this.selectedWarehouseId) {
        const first = this.warehousesForBranch[0];
        if (first) this.setWarehouse(first.id);
      }
      return this.warehouses;
    },

    async createBranch(payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/branches', payload);
        await this.fetchBranches();
        notificationStore.success('تم إضافة الفرع');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل إضافة الفرع');
        throw error;
      }
    },

    async createWarehouse(payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/warehouses', payload);
        await this.fetchWarehouses();
        notificationStore.success('تم إضافة المخزن');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل إضافة المخزن');
        throw error;
      }
    },

    async fetchWarehouseStock(warehouseId = this.selectedWarehouseId, filters = {}) {
      if (!warehouseId) return [];
      this.loading = true;
      try {
        const response = await api.get(`/inventory/warehouses/${warehouseId}/stock`, {
          params: filters,
        });
        this.stock = response?.data || [];
        return this.stock;
      } finally {
        this.loading = false;
      }
    },

    async fetchLowStock(warehouseId = this.selectedWarehouseId) {
      if (!warehouseId) return [];
      const response = await api.get(`/inventory/warehouses/${warehouseId}/low-stock`);
      this.lowStock = response?.data || [];
      return this.lowStock;
    },

    async adjustStock(payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/inventory/adjust', payload);
        notificationStore.success('تم تعديل المخزون');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل تعديل المخزون');
        throw error;
      }
    },

    async transferStock(payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/inventory/transfer', payload);
        notificationStore.success('تم نقل المخزون');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل نقل المخزون');
        throw error;
      }
    },

    // ── Warehouse transfer requests ─────────────────────────────────────────
    async fetchTransfers(filters = {}) {
      const response = await api.get('/warehouse-transfers', { params: filters });
      return response?.data || [];
    },

    async requestTransfer(payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/warehouse-transfers', payload);
        notificationStore.success('تم إرسال طلب النقل للموافقة');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل إرسال طلب النقل');
        throw error;
      }
    },

    async approveTransfer(id) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post(`/warehouse-transfers/${id}/approve`);
        notificationStore.success('تمت الموافقة على النقل');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل الموافقة');
        throw error;
      }
    },

    async rejectTransfer(id, reason) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post(`/warehouse-transfers/${id}/reject`, { reason });
        notificationStore.success('تم رفض النقل');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل الرفض');
        throw error;
      }
    },

    async fetchMovements(filters = {}) {
      this.loading = true;
      try {
        const params = {
          warehouseId: filters.warehouseId ?? this.selectedWarehouseId ?? undefined,
          productId: filters.productId,
          movementType: filters.movementType,
          page: filters.page || 1,
          limit: filters.limit || 20,
        };
        const response = await api.get('/inventory/movements', { params });
        this.movements = response?.data || [];
        if (response?.meta) {
          this.movementsPagination = {
            page: Number(response.meta.page) || 1,
            limit: Number(response.meta.limit) || 20,
            total: Number(response.meta.total) || 0,
            totalPages: Number(response.meta.totalPages) || 0,
          };
        }
        return this.movements;
      } finally {
        this.loading = false;
      }
    },
  },
});
