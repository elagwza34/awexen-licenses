import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { setPortalToken } from '@/lib/portal-api';

export function PortalForgotPasswordPage() {
  const [email,setEmail]=useState('');const navigate=useNavigate();
  const request=useMutation({mutationFn:()=>api.post('/portal/forgot-password',{email:email.trim()})});
  return <div className="flex min-h-screen items-center justify-center p-5"><Card className="w-full max-w-md">
    <CardHeader><CardTitle>نسيت كلمة المرور؟</CardTitle></CardHeader><CardContent>
      <form className="space-y-4" onSubmit={event=>{event.preventDefault();request.mutate();}}>
        <p>أدخل البريد المسجل لحساب مالك الشركة لإرسال رابط مؤقت لاستعادة كلمة المرور.</p>
        <Label htmlFor="recovery-email">البريد الإلكتروني</Label><Input id="recovery-email" type="email" required maxLength={180} value={email} onChange={e=>setEmail(e.target.value)} dir="ltr" autoComplete="email"/>
        {request.isSuccess&&<p role="status">إذا كان البريد مرتبطًا بحساب متاح، سيصلك رابط صالح لمدة 30 دقيقة. راجع البريد غير الهام.</p>}
        {request.isError&&<p role="alert" className="text-destructive">تعذر إرسال الطلب الآن. حاول لاحقًا أو تواصل مع الدعم.</p>}
        <Button type="submit" isLoading={request.isPending} disabled={request.isPending}>إرسال رابط الاستعادة</Button>
        <Button type="button" variant="outline" onClick={()=>navigate('/portal/login')}>العودة لتسجيل الدخول</Button>
      </form>
    </CardContent></Card></div>;
}

export function PortalResetPasswordPage() {
  const [token]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('token')??'');
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState('');const navigate=useNavigate();
  useEffect(()=>{window.history.replaceState(null,'',window.location.pathname);},[]);
  const reset=useMutation({mutationFn:()=>api.post('/portal/reset-password',{token,password}),onSuccess:()=>setPortalToken(null)});
  const valid=/^[A-Za-z0-9_-]{43}$/.test(token);
  return <div className="flex min-h-screen items-center justify-center p-5"><Card className="w-full max-w-md"><CardHeader><CardTitle>تعيين كلمة مرور جديدة</CardTitle></CardHeader><CardContent>
    {reset.isSuccess?<div className="space-y-4"><p role="status">تم تغيير كلمة المرور. سجّل الدخول إلى حسابك وبرنامج PMS بالكلمة الجديدة.</p><Button onClick={()=>navigate('/portal/login')}>تسجيل الدخول</Button></div>:
    <form className="space-y-4" onSubmit={event=>{event.preventDefault();if(password===confirm&&valid)reset.mutate();}}>
      {!valid&&<p role="alert" className="text-destructive">الرابط غير صالح. اطلب رابط استعادة جديدًا.</p>}
      <p>12 حرفًا على الأقل، تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا. الرابط يُستخدم مرة واحدة.</p>
      <Label htmlFor="new-password">كلمة المرور الجديدة</Label><Input id="new-password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
      <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label><Input id="confirm-password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/>
      {confirm&&confirm!==password&&<p role="alert" className="text-destructive">كلمتا المرور غير متطابقتين.</p>}
      {reset.isError&&<p role="alert" className="text-destructive">تعذر تغيير كلمة المرور. تحقق من شروطها أو اطلب رابطًا جديدًا إن انتهت صلاحيته.</p>}
      <Button type="submit" isLoading={reset.isPending} disabled={!valid||reset.isPending||password!==confirm}>حفظ كلمة المرور</Button>
      <Button type="button" variant="outline" onClick={()=>navigate('/portal/forgot-password')}>طلب رابط جديد</Button>
    </form>}
  </CardContent></Card></div>;
}
