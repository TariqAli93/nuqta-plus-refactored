import { defineStore } from 'pinia';

export const useLicenseStore = defineStore('license', {
  state: () => ({
    licenseInfo: {
      type: 'enterprise',
      features: {
        maxProducts: -1,
        maxCustomers: -1,
        maxSales: -1,
        maxUsers: -1,
        canBackup: true,
        canImportExport: true,
        canInstallments: true,
        canAdvancedReports: true,
        canCustomRoles: true,
        hasWatermark: false,
      },
      expiryDate: null,
      daysRemaining: 9999,
      inGracePeriod: false,
      isExpired: false,
      isRevoked: false,
      revokedMessage: null,
      isInvalid: false,
      invalidReason: null,
      invalidMessage: null,
      licenseKey: 'UNLIMITED-LICENSE',
    },
    loading: false,
    error: null,
  }),

  getters: {
    licenseType: () => 'enterprise',
    features: (state) => state.licenseInfo.features,
    isExpired: () => false,
    inGracePeriod: () => false,
    daysRemaining: () => 9999,
    expiryDate: () => null,
    isActive: () => true,

    isFeatureAllowed: () => () => true,
    getFeatureLimit: () => () => -1,
    exceedsLimit: () => () => false,

    licenseKey: () => 'UNLIMITED-LICENSE',
    isRevoked: () => false,
    revokedMessage: () => null,
    isInvalid: () => false,
    invalidReason: () => null,
    invalidMessage: () => null,
    isBlocked: () => false,
  },

  actions: {
    async loadLicenseInfo() {
      // No-op or just return success
      return;
    },

    async activateLicense() {
      return { success: true };
    },

    async verifyLicense() {
      return { success: true };
    },

    async validateWithServer() {
      return { success: true };
    },

    startPeriodicValidation() {
      // No-op
    },

    stopPeriodicValidation() {
      // No-op
    },

    needsUpgrade() {
      return false;
    },

    getRecommendedLicense() {
      return null;
    },
  },
});
