import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Input,Label} from '@/components/ui/input';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useToast} from '@/hooks/use-toast';
import type {Plan} from '@/types';

export function ReleaseForm({onClose}:{onClose:()=>void}){
 const cache=useQueryClient(),toast=useToast();
 const [version,setVersion]=useState('1.4.3'),[build,setBuild]=useState('1403'),[plan,setPlan]=useState('all');
 const [url,setUrl]=useState(''),[checksum,setChecksum]=useState(''),[size,setSize]=useState(''),[notes,setNotes]=useState('');
 const plans=useQuery({queryKey:['plans'],queryFn:()=>api.get<{data:Plan[]}>('/plans')});
 const save=useMutation({mutationFn:()=>api.post('/releases',{version,buildNumber:Number(build),platform:'WINDOWS',channel:plan==='all'?'stable':`stable-plan-${plan}`,downloadUrl:url,checksum,fileSize:Number(size),releaseNotes:notes,isRequired:false}),
 onSuccess:()=>{cache.invalidateQueries({queryKey:['releases']});toast.success('تم إنشاء مسودة الإصدار');onClose();},onError:error=>toast.error('تعذر إنشاء الإصدار',(error as ApiError).friendlyMessage)});
 return <Card><CardHeader><CardTitle>إصدار جديد — مسودة</CardTitle></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();save.mutate();}}>
 <div><Label>رقم الإصدار</Label><Input required pattern="[0-9]+(\.[0-9]+){1,3}" value={version} onChange={e=>setVersion(e.target.value)}/></div>
 <div><Label>رقم البناء</Label><Input type="number" min="0" required value={build} onChange={e=>setBuild(e.target.value)}/></div>
 <div className="sm:col-span-2"><Label>الخطط التي تستقبل الإصدار</Label><select className="block w-full rounded border p-2" value={plan} onChange={e=>setPlan(e.target.value)}><option value="all">كل الخطط المدفوعة — بدون تغيير مميزات الاشتراك</option>{plans.data?.data.map(p=><option key={p.id} value={p.id}>{p.nameAr||p.name}</option>)}</select></div>
 <div className="sm:col-span-2"><Label>رابط ملف التثبيت HTTPS</Label><Input type="url" required value={url} onChange={e=>setUrl(e.target.value)}/></div>
 <div><Label>SHA256</Label><Input required pattern="[0-9a-fA-F]{64}" value={checksum} onChange={e=>setChecksum(e.target.value)}/></div>
 <div><Label>حجم الملف بالبايت</Label><Input type="number" min="1" required value={size} onChange={e=>setSize(e.target.value)}/></div>
 <div className="sm:col-span-2"><Label>ما الجديد؟</Label><Input value={notes} onChange={e=>setNotes(e.target.value)}/></div>
 <p className="sm:col-span-2 text-sm text-muted-foreground">ارفع ملف التثبيت أولًا وتحقق من بصمته. المسودة لا تظهر للعملاء حتى نشرها. الإعلان لا يثبت التحديث تلقائيًا ولا يرقّي خطة العميل.</p>
 <Button type="submit" isLoading={save.isPending} disabled={save.isPending||plans.isLoading}>حفظ مسودة</Button><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
 </form></CardContent></Card>;
}
