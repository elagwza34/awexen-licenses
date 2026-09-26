import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Moon, Shield, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, NAV_SECTIONS } from '@/lib/navigation';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';

/** Adds or removes the `dark` class on <html>. */
function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { admin, can, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const toast = useToast();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Even if the revoke call fails, the local session is cleared.
    } finally {
      toast.show('تم تسجيل الخروج');
    }
  };

  return (
    <aside className="flex h-full w-64 flex-col border-e border-border bg-card">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">لوحة تحكم المالك</p>
          <p className="ltr truncate text-[11px] text-muted-foreground">Owner Control Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => {
          // Hide a whole section when the admin has none of its permissions.
          const visible = section.items.filter((item) => !item.permission || can(item.permission));
          if (visible.length === 0) return null;

          return (
            <div key={section.title}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.path === '/'
                      ? location.pathname === '/'
                      : location.pathname.startsWith(item.path);

                  return (
                    <li key={item.path}>
                      <NavLink
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
                        <span className="ltr hidden text-[10px] opacity-50 xl:inline">{item.labelEn}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Signed-in admin */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-md p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {initials(admin?.name ?? '?')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{admin?.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {admin?.roles.map((role) => ROLE_LABELS[role]).join(' • ')}
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
            onClick={handleLogout}
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
