export const inventoryMovementTypeLabels = {
  opening_balance: 'رصيد افتتاحي',
  stock_in: 'إدخال مخزون',
  stock_out: 'إخراج مخزون',
  adjustment_in: 'تسوية زيادة',
  adjustment_out: 'تسوية نقصان',
  correction_in: 'تصحيح زيادة',
  correction_out: 'تصحيح نقصان',
  damaged: 'تالف',
  lost: 'فقدان',
  sale: 'بيع',
  sale_cancel: 'إلغاء بيع',
  sale_return: 'إرجاع بيع',
  purchase_in: 'استلام شراء',
  transfer_in: 'نقل وارد',
  transfer_out: 'نقل صادر',
  manual_adjustment_in: 'إدخال يدوي',
  manual_adjustment_out: 'إخراج يدوي',
};

export const getInventoryMovementTypeLabel = (type) =>
  inventoryMovementTypeLabels[type] || 'غير معروف';

export const manualInventoryMovementTypes = [
  'opening_balance',
  'stock_in',
  'adjustment_in',
  'adjustment_out',
  'correction_in',
  'correction_out',
  'damaged',
  'lost',
];
