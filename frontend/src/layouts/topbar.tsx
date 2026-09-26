import { ChevronLeft, Menu } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { NAV_SECTIONS } from '@/lib/navigation';

interface Crumb {
  label: string;
  path?: string;
}

/**
 * Breadcrumbs are derived from the route, with dynamic segments (ids) resolved
 * to a readable form rather than dumping "7" into the trail.
 */
function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'لوحة التحكم' }];

  const allItems = NAV_SECTIONS.flatMap((section) => section.items);
  const crumbs: Crumb[] = [{ label: 'لوحة التحكم', path: '/' }];

  let accumulated = '';
  segments.forEach((segment, index) => {
    accumulated += `/${segment}`;
    const isLast = index === segments.length - 1;
    const navItem = allItems.find((item) => item.path === accumulated);

    if (navItem) {
      // Don't repeat "لوحة التحكم" for the root path.
      crumbs.push({ label: navItem.label, path: isLast ? undefined : accumulated });
    } else if (isLast && /^\d+$/.test(segment)) {
      crumbs.push({ label: `#${segment}` });
    } else if (isLast) {
      crumbs.push({ label: segment });
    }
  });

  return crumbs;
}

export function Topbar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/95 px-4 backdrop-blur">
      {onOpenMenu && (
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="القائمة">
          <Menu className="h-5 w-5" />
        </Button>
      )}

      <nav aria-label="مسار التنقل" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <div key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {crumb.path ? (
              <Link
                to={crumb.path}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate font-medium">{crumb.label}</span>
            )}
          </div>
        ))}
      </nav>
    </header>
  );
}
