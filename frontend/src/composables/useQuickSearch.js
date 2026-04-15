import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useProductStore } from '@/stores/product';
import { useCustomerStore } from '@/stores/customer';
import { useSaleStore } from '@/stores/sale';

export function useQuickSearch() {
  const router = useRouter();
  const productStore = useProductStore();
  const customerStore = useCustomerStore();
  const saleStore = useSaleStore();

  const query = ref('');
  const isOpen = ref(false);
  const isLoading = ref(false);
  const results = ref([]);

  const searchResults = computed(() => {
    if (!query.value.trim()) {
      return {
        pages: [
          { title: 'المبيعات', to: '/sales', icon: 'mdi-cash-register', type: 'page' },
          { title: 'العملاء', to: '/customers', icon: 'mdi-account-group', type: 'page' },
          { title: 'المنتجات', to: '/products', icon: 'mdi-package-variant', type: 'page' },
        ],
        products: [],
        customers: [],
        sales: [],
      };
    }

    return {
      pages: results.value.filter((r) => r.type === 'page'),
      products: results.value.filter((r) => r.type === 'product'),
      customers: results.value.filter((r) => r.type === 'customer'),
      sales: results.value.filter((r) => r.type === 'sale'),
    };
  });

  const performSearch = async () => {
    if (!query.value.trim()) {
      results.value = [];
      return;
    }

    isLoading.value = true;
    try {
      const searchPromises = [];

      // Search products
      searchPromises.push(
        productStore.fetch({ search: query.value, limit: 5 }).then((res) => {
          return (res.data || []).map((p) => ({
            id: p.id,
            title: p.name,
            subtitle: `SKU: ${p.sku} | المخزون: ${p.stock}`,
            icon: 'mdi-package-variant',
            type: 'product',
            to: `/products/${p.id}/edit`,
          }));
        })
      );

      // Search customers
      searchPromises.push(
        customerStore.fetch({ search: query.value, limit: 5 }).then((res) => {
          return (res.data || []).map((c) => ({
            id: c.id,
            title: c.name,
            subtitle: c.phone || '',
            icon: 'mdi-account',
            type: 'customer',
            to: `/customers/${c.id}/edit`,
          }));
        })
      );

      // Search sales
      searchPromises.push(
        saleStore.fetch({ search: query.value, limit: 5 }).then((res) => {
          return (res.data || []).map((s) => ({
            id: s.id,
            title: `فاتورة #${s.invoiceNumber}`,
            subtitle: s.customer || 'زبون نقدي',
            icon: 'mdi-receipt',
            type: 'sale',
            to: `/sales/${s.id}`,
          }));
        })
      );

      const [products, customers, sales] = await Promise.all(searchPromises);

      results.value = [...products, ...customers, ...sales];
    } catch (error) {
      console.error('Search error:', error);
      results.value = [];
    } finally {
      isLoading.value = false;
    }
  };

  const open = () => {
    isOpen.value = true;
    query.value = '';
    results.value = [];
  };

  const close = () => {
    isOpen.value = false;
    query.value = '';
    results.value = [];
  };

  const selectResult = (result) => {
    if (result.to) {
      router.push(result.to);
      close();
    }
  };

  return {
    query,
    isOpen,
    isLoading,
    searchResults,
    performSearch,
    open,
    close,
    selectResult,
  };
}
