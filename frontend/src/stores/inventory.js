import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';
import { useAuthStore } from '@/stores/auth';

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
    // Set when the active branch has no default warehouse configured.
    // The UI surfaces this as a non-blocking admin warning.
    missingDefaultWarehouse: false,
    initialized: false,
  }),

  getters: {
    selectedBranch(state) {
      return state.branches.find((b) => b.id === state.selectedBranchId) || null;
    },
    selectedWarehouse(state) {
      return state.warehouses.find((w) => w.id === state.selectedWarehouseId) || null;
    },
    /**
     * Warehouses visible for the current selection.
     * - Branch feature ON  → warehouses for the active branch only.
     * - Branch feature OFF → all warehouses (branches are ignored).
     */
    warehousesForBranch(state) {
      const auth = useAuthStore();
      const branchOn = auth.hasFeature("multiBranch");
      if (!branchOn) return state.warehouses;
      if (!state.selectedBranchId) return state.warehouses;
      return state.warehouses.filter(
        (w) => w.branchId === state.selectedBranchId || w.branchId == null
      );
    },
    lowStockCount: (state) => state.lowStock.length,
  },

  actions: {
    setBranch(id, { silent = false } = {}) {
      this.selectedBranchId = id || null;
      writeLS(LS_BRANCH, this.selectedBranchId);
      // If the chosen warehouse is no longer in the branch, drop it now —
      // `resolveActiveWarehouse` will pick a fresh one.
      if (
        this.selectedWarehouseId &&
        this.warehouses.length > 0 &&
        !this.warehouses.some(
          (w) => w.id === this.selectedWarehouseId && w.branchId === this.selectedBranchId
        )
      ) {
        this.selectedWarehouseId = null;
        writeLS(LS_WAREHOUSE, null);
      }
      if (!silent) {
        this.resolveActiveWarehouse();
      }
    },
    setWarehouse(id) {
      this.selectedWarehouseId = id || null;
      writeLS(LS_WAREHOUSE, this.selectedWarehouseId);
    },

    async fetchBranches() {
      const response = await api.get('/branches');
      this.branches = response?.data || [];
      return this.branches;
    },

    async fetchWarehouses(branchId) {
      const auth = useAuthStore();
      const branchOn = auth.hasFeature("multiBranch");
      const params = { activeOnly: true };
      if (branchOn && branchId) params.branchId = branchId;
      const response = await api.get('/warehouses', { params });
      this.warehouses = response?.data || [];
      return this.warehouses;
    },

    /**
     * Pick the active warehouse for the current branch.
     *
     *  - When branch feature is ON: prefer the branch's defaultWarehouseId,
     *    fall back to the first active warehouse in the branch.
     *  - When branch feature is OFF: prefer the user's assigned warehouse,
     *    fall back to the first active warehouse globally.
     *
     * Sets `missingDefaultWarehouse` when the branch has no default
     * configured so the UI can surface an admin warning.
     */
    async resolveActiveWarehouse() {
      const auth = useAuthStore();
      const branchOn = auth.hasFeature("multiBranch");
      this.missingDefaultWarehouse = false;

      // Branches OFF → global warehouse list, no branch filter.
      if (!branchOn) {
        const pool = this.warehouses.filter((w) => w.isActive !== false);
        const allowed = auth.allowedWarehouseIds || [];
        const visible = allowed.length
          ? pool.filter((w) => allowed.includes(w.id))
          : pool;
        if (
          this.selectedWarehouseId &&
          visible.some((w) => w.id === this.selectedWarehouseId)
        ) {
          return; // current selection is still valid
        }
        const next = auth.assignedWarehouseId || auth.scope?.warehouseId || visible[0]?.id || null;
        this.setWarehouse(next);
        return;
      }

      // Branches ON → must have an active branch first.
      if (!this.selectedBranchId) {
        this.setWarehouse(null);
        return;
      }

      try {
        const response = await api.get(
          `/branches/${this.selectedBranchId}/active-warehouse`
        );
        const data = response?.data || {};
        this.missingDefaultWarehouse = data.hasDefault === false;
        if (data.warehouseId) {
          this.setWarehouse(data.warehouseId);
          return;
        }
      } catch {
        // Fall through to local fallback if the API call fails.
      }

      // Local fallback when the API didn't return anything.
      const pool = this.warehouses.filter(
        (w) => w.isActive !== false && w.branchId === this.selectedBranchId
      );
      const allowed = auth.allowedWarehouseIds || [];
      const visible = allowed.length
        ? pool.filter((w) => allowed.includes(w.id))
        : pool;
      const next = visible[0]?.id || null;
      this.setWarehouse(next);
    },

    /**
     * Single initialization entry point for branch + warehouse state.
     * Called once after the auth store is hydrated. Idempotent — safe to
     * call multiple times; only the first run does the heavy lifting.
     *
     * Steps:
     *  1) Load branches (if branches feature is on) and warehouses.
     *  2) Resolve the active branch from auth scope or stale localStorage.
     *  3) Resolve the active warehouse for that branch.
     */
    async initialize({ force = false } = {}) {
      if (this.initialized && !force) return;
      const auth = useAuthStore();
      if (!auth.isAuthenticated) return;

      const branchOn = auth.hasFeature("multiBranch");

      // Always fetch warehouses; only fetch branches when branches are on.
      const tasks = [this.fetchWarehouses()];
      if (branchOn) tasks.push(this.fetchBranches());
      await Promise.all(tasks);

      if (branchOn) {
        const allowed = auth.allowedBranchIds || [];
        const assigned = auth.assignedBranchId || null;
        let nextBranchId = null;
        if (assigned && (allowed.length === 0 || allowed.includes(assigned))) {
          // Normal users (and admins with a default branch) start on their
          // assigned branch.
          nextBranchId = assigned;
        } else if (
          this.selectedBranchId &&
          (allowed.length === 0 || allowed.includes(this.selectedBranchId))
        ) {
          // Honor the previously selected branch only when the user is still
          // allowed to see it.
          nextBranchId = this.selectedBranchId;
        } else if (this.branches.length > 0) {
          nextBranchId = this.branches[0].id;
        }
        this.setBranch(nextBranchId, { silent: true });
      } else {
        // Stale branch ID is ignored entirely while branches are off.
        this.selectedBranchId = null;
        writeLS(LS_BRANCH, null);
      }

      await this.resolveActiveWarehouse();
      this.initialized = true;
    },

    /**
     * Wipe the in-memory state on logout. localStorage is cleared by the
     * auth store. Called from the auth store so the next user starts fresh.
     */
    reset() {
      this.branches = [];
      this.warehouses = [];
      this.selectedBranchId = null;
      this.selectedWarehouseId = null;
      this.stock = [];
      this.movements = [];
      this.movementsPagination = { page: 1, limit: 20, total: 0, totalPages: 0 };
      this.lowStock = [];
      this.missingDefaultWarehouse = false;
      this.initialized = false;
      writeLS(LS_BRANCH, null);
      writeLS(LS_WAREHOUSE, null);
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

    async updateBranch(id, payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.put(`/branches/${id}`, payload);
        await this.fetchBranches();
        notificationStore.success('تم تحديث الفرع');
        // The branch_manager case: changing the default warehouse for the
        // user's own branch should also update the cached scope so the next
        // login (and any /auth/profile reload) reflects the new default.
        // We refresh the profile asynchronously to keep the UI snappy; if it
        // fails we still have the optimistic local update.
        if (this.selectedBranchId === Number(id)) {
          const auth = useAuthStore();
          if (
            !auth.isGlobalAdmin &&
            Number(auth.assignedBranchId) === Number(id) &&
            payload?.defaultWarehouseId !== undefined
          ) {
            try {
              await auth.getProfile();
            } catch {
              // Non-fatal — local state is already consistent.
            }
          }
          await this.resolveActiveWarehouse();
        }
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل تحديث الفرع');
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

    async updateWarehouse(id, payload) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.put(`/warehouses/${id}`, payload);
        await this.fetchWarehouses();
        notificationStore.success('تم تحديث المخزن');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل تحديث المخزن');
        throw error;
      }
    },

    async deleteWarehouse(id) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.delete(`/warehouses/${id}`);
        await this.fetchWarehouses();
        notificationStore.success(response?.message || 'تم حذف المخزن');
        return response.data;
      } catch (error) {
        notificationStore.error(error?.message || 'فشل حذف المخزن');
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
    async fetchExpiryAlerts(filters = {}) {
      const response = await api.get('/inventory/expiry-alerts', { params: filters });
      return response?.data || [];
    },
  },
});
