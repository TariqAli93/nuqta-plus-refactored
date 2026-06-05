<script setup>
import { computed } from 'vue';

// Maps a backend `matchedField` key to a short Arabic "matched in …" label
// (req #13/#16). Unknown/empty keys render nothing.
const LABELS = {
  barcode: 'مطابق في الباركود',
  sku: 'مطابق في الرمز (SKU)',
  name: 'مطابق في الاسم',
  invoiceNumber: 'مطابق في رقم الفاتورة',
  customerName: 'مطابق في اسم الزبون',
  customerPhone: 'مطابق في هاتف الزبون',
  phone: 'مطابق في الهاتف',
  address: 'مطابق في العنوان',
  notes: 'مطابق في الملاحظات',
  category: 'مطابق في التصنيف',
  unit: 'مطابق في الوحدة',
  supplier: 'مطابق في المورد',
  salePrice: 'مطابق في سعر البيع',
  purchasePrice: 'مطابق في سعر الشراء',
  productName: 'مطابق من داخل الفاتورة',
  paymentMethod: 'مطابق في طريقة الدفع',
  status: 'مطابق في الحالة',
};

const props = defineProps({
  field: { type: String, default: null },
  // Optional value to show in the tooltip (e.g. the matched product name).
  value: { type: [String, Number], default: null },
});

const label = computed(() => (props.field ? LABELS[props.field] : null));
// "Inside the invoice" matches get a distinct colour/icon so a row that matched
// on a line-item reads differently from one that matched on the invoice itself.
const isInsideInvoice = computed(() => props.field === 'productName');
</script>

<template>
  <v-chip
    v-if="label"
    size="x-small"
    variant="tonal"
    :color="isInsideInvoice ? 'secondary' : 'primary'"
    class="match-badge"
    :title="value != null ? `${label}: ${value}` : label"
  >
    <v-icon start size="12">{{ isInsideInvoice ? 'mdi-package-variant-closed' : 'mdi-magnify' }}</v-icon>
    {{ label }}
  </v-chip>
</template>

<style scoped lang="scss">
.match-badge {
  font-size: 0.7rem;
  font-weight: 500;
}
</style>
