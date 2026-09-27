import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePortalCustomer } from '@/hooks/use-portal';
import { PORTAL_NAV } from '@/lib/portal-navigation';
import { setPortalToken } from '@/lib/portal-api';
import { cn, initials } from '@/lib/utils';

/** Adds or removes the `dark` class on <html>. */
function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}

export function PortalSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const customer = usePortalCustomer();
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const signOut = () => {
    setPortalToken(null);
    navigate('/portal/login', { replace: true });
  };

  return (
    <aside className="flex h-full w-64 flex-col border-e border-border bg-card">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">بوابة العميل</p>
          <p className="ltr truncate text-[11px] text-muted-foreground">Customer Portal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {PORTAL_NAV.map((item) => {
          const Icon = item.icon;
          // "/" would match every route, so the dashboard compares exactly.
          const isActive =
            item.path === '/portal'
              ? location.pathname === '/portal'
              : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-md p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {initials(customer.data?.name ?? '؟')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{customer.data?.name ?? '—'}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {customer.data?.company ?? 'مشترك'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={dark ? 'الوضع النهاري' : 'الوضع الليلي'}
            className="h-8 w-8"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            aria-label="تسجيل الخروج"
            className="h-8 w-8 text-destructive hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
