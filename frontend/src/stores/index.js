// make this file a module by adding an export statement
import { useSaleStore } from './sale';
import { useProductStore } from './product';
import { useCustomerStore } from './customer';
import { useNotificationStore } from './notification';
import { useAuthStore } from './auth';
import { useCategoryStore } from './category';
import { useSettingsStore } from './settings';

export {
  useSaleStore,
  useProductStore,
  useCustomerStore,
  useNotificationStore,
  useAuthStore,
  useCategoryStore,
  useSettingsStore,
};
