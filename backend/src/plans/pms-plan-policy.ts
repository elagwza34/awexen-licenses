export const PMS_FEATURES = {
  PRODUCTS: 'المنتجات', INVENTORY: 'المخزون', SALES: 'المبيعات', POS: 'نقطة البيع',
  CUSTOMERS: 'العملاء', REPORTS: 'التقارير الأساسية', SUPPLIERS: 'الموردون',
  PURCHASES: 'المشتريات', EMPLOYEES: 'الموظفون', ATTENDANCE: 'الحضور والانصراف',
  IMPORT: 'استيراد الأصناف', EXPORT: 'تصدير Excel', ADVANCED_REPORTS: 'الأرباح والتقارير المتقدمة',
  MULTI_WAREHOUSE: 'عدة مخازن', MULTI_BRANCH: 'عدة فروع',
} as const;
const BASIC = ['PRODUCTS','INVENTORY','SALES','POS','CUSTOMERS','REPORTS'];
const PRO = [...BASIC,'SUPPLIERS','PURCHASES','EMPLOYEES','ATTENDANCE','IMPORT','EXPORT','ADVANCED_REPORTS','MULTI_WAREHOUSE'];
/** Archived templates require an explicit price and activation before customers can select them. */
export const PMS_PLAN_PRESETS = [
  {key:'PMS_STARTER',name:'PMS Starter',nameAr:'بداية',maxUsers:2,maxBranches:1,maxWarehouses:1,maxDevices:1,features:BASIC},
  {key:'PMS_PRO',name:'PMS Professional',nameAr:'احترافي',maxUsers:5,maxBranches:1,maxWarehouses:3,maxDevices:1,features:PRO},
  {key:'PMS_BUSINESS',name:'PMS Business',nameAr:'أعمال',maxUsers:20,maxBranches:5,maxWarehouses:20,maxDevices:3,features:[...PRO,'MULTI_BRANCH']},
];
export function validatePmsPolicy(features:string[],limits:{maxBranches:number;maxWarehouses:number}):string|undefined {
  const selected=new Set(features);
  if(features.some(key=>!Object.prototype.hasOwnProperty.call(PMS_FEATURES,key)))return 'الخطة تحتوي مميزات غير مدعومة في PMS الحالي.';
  if(!selected.has('PRODUCTS'))return 'المنتجات مطلوبة لكل خطة PMS.';
  const dependencies:Record<string,string[]>={SALES:['PRODUCTS','INVENTORY','CUSTOMERS'],POS:['SALES'],PURCHASES:['PRODUCTS','INVENTORY','SUPPLIERS'],ATTENDANCE:['EMPLOYEES'],IMPORT:['PRODUCTS'],ADVANCED_REPORTS:['REPORTS'],MULTI_WAREHOUSE:['INVENTORY']};
  for(const [feature,required] of Object.entries(dependencies))if(selected.has(feature)&&required.some(key=>!selected.has(key)))return `الميزة ${feature} تحتاج: ${required.join(', ')}.`;
  if(limits.maxWarehouses>1&&!selected.has('MULTI_WAREHOUSE'))return 'أكثر من مخزن يحتاج ميزة تعدد المخازن.';
  if(limits.maxBranches>1&&!selected.has('MULTI_BRANCH'))return 'أكثر من فرع يحتاج ميزة تعدد الفروع.';
}
