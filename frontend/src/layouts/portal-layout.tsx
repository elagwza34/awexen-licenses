import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { PortalSidebar } from './portal-sidebar';
import { PortalTopbar } from './portal-topbar';

/**
 * The customer portal shell.
 *
 * Structurally the same as the owner panel — a sticky sidebar, a topbar and a
 * scrolling main — so the two feel like one product, but built from its own
 * components. Sharing them would mean threading the admin session through a
 * component that has no concept of a customer, and the customer token must
 * never be sent to an admin endpoint.
 */
export function PortalLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background" dir="rtl">
      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">
        <PortalSidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 start-0 w-64 animate-fade-in">
            <PortalSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <PortalTopbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
