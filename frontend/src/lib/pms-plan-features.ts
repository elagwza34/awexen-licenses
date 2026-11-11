export const PMS_FEATURE_LABELS: Record<string, string> = {
  PRODUCTS: 'المنتجات', INVENTORY: 'المخزون', SALES: 'المبيعات', POS: 'نقطة البيع',
  CUSTOMERS: 'العملاء', REPORTS: 'التقارير الأساسية', SUPPLIERS: 'الموردون',
  PURCHASES: 'المشتريات', EMPLOYEES: 'الموظفون', ATTENDANCE: 'الحضور والانصراف',
  IMPORT: 'استيراد الأصناف', EXPORT: 'تصدير Excel', ADVANCED_REPORTS: 'الأرباح والتقارير المتقدمة',
  MULTI_WAREHOUSE: 'عدة مخازن', MULTI_BRANCH: 'عدة فروع',
};

const dependencies: Record<string, string[]> = {
  SALES: ['PRODUCTS', 'INVENTORY', 'CUSTOMERS'], POS: ['SALES'],
  PURCHASES: ['PRODUCTS', 'INVENTORY', 'SUPPLIERS'], ATTENDANCE: ['EMPLOYEES'],
  IMPORT: ['PRODUCTS'], ADVANCED_REPORTS: ['REPORTS'], MULTI_WAREHOUSE: ['INVENTORY'],
};

export function pmsFeatureRequirements(key: string): string {
  return (dependencies[key] ?? []).map(value => PMS_FEATURE_LABELS[value]).join('، ');
}

export function validatePmsSelection(keys: string[], maxBranches: number, maxWarehouses: number): string | undefined {
  const selected = new Set(keys);
  if (keys.some(key => !Object.prototype.hasOwnProperty.call(PMS_FEATURE_LABELS, key)))
    return 'أزل المميزات غير المدعومة في PMS قبل حفظ الخطة.';
  if (!selected.has('PRODUCTS')) return 'اختر المنتجات؛ هي الميزة الأساسية لكل خطة PMS.';
  for (const [feature, required] of Object.entries(dependencies))
    if (selected.has(feature) && required.some(key => !selected.has(key)))
      return `${PMS_FEATURE_LABELS[feature]} تحتاج: ${pmsFeatureRequirements(feature)}.`;
  if (maxWarehouses > 1 && !selected.has('MULTI_WAREHOUSE')) return 'أكثر من مخزن يحتاج ميزة عدة مخازن.';
  if (maxBranches > 1 && !selected.has('MULTI_BRANCH')) return 'أكثر من فرع يحتاج ميزة عدة فروع.';
}
