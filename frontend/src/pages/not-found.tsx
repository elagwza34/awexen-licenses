import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="ltr text-6xl font-bold text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold">الصفحة غير موجودة</h1>
      <p className="text-sm text-muted-foreground">الرابط الذي طلبته غير متاح.</p>
      <Button asChild>
        <Link to="/">
          <Home />
          العودة للوحة التحكم
        </Link>
      </Button>
    </div>
  );
}
