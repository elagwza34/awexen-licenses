import { ChevronLeft, Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PORTAL_NAV } from '@/lib/portal-navigation';

/**
 * Breadcrumbs for the customer portal, derived from the route.
 *
 * The active item's own description is shown beside it so the customer can see
 * what the page is for without reading the sidebar.
 */
export function PortalTopbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { pathname } = useLocation();
  const current = PORTAL_NAV.find((item) =>
    item.path === '/portal' ? pathname === '/portal' : pathname.startsWith(item.path),
  );
  const isRoot = pathname === '/portal' || pathname === '/portal/';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/95 px-4 backdrop-blur">
      {onOpenMenu && (
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="القائمة">
          <Menu className="h-5 w-5" />
        </Button>
      )}

      <nav aria-label="مسار التنقل" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {!isRoot && (
          <>
            <Link to="/portal" className="truncate text-muted-foreground transition-colors hover:text-foreground">
              لوحة العميل
            </Link>
            <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate font-medium">{current?.label ?? 'بوابة العميل'}</span>
      </nav>

      {current && !isRoot && (
        <p className="hidden truncate text-xs text-muted-foreground md:block">{current.description}</p>
      )}
    </header>
  );
}
