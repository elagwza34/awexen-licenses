import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Boxes, ArrowLeft } from "lucide-react";
import { portalApi } from "@/lib/portal-api";
import { Button } from "@/components/ui/button";

export function PortalSystemsPage() {
  const systems = useQuery({
    queryKey: ["portal", "systems"],
    queryFn: portalApi.systems,
  });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">الأنظمة والاشتراكات</h1>
        <p className="mt-2 text-muted-foreground">
          اختر النظام، ثم اختر الخطة ومدة الاشتراك المناسبة لك.
        </p>
      </header>
      {systems.isLoading && <p role="status">جارٍ تحميل الأنظمة…</p>}
      {systems.isError && (
        <div role="alert">
          <p>تعذر تحميل الأنظمة.</p>
          <Button
            className="min-h-11 min-w-11"
            variant="outline"
            onClick={() => systems.refetch()}
          >
            إعادة المحاولة
          </Button>
        </div>
      )}
      {systems.data && !systems.data.data.length && (
        <p role="status">لا توجد أنظمة متاحة حاليًا.</p>
      )}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {systems.data?.data.map((system) => (
          <Link
            key={system.id}
            to={"/portal/subscription/" + encodeURIComponent(system.key)}
            className="group rounded-xl border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Boxes aria-hidden="true" className="mb-5 size-10 text-primary" />
            <h2 className="text-lg font-bold">{system.nameAr}</h2>
            {system.description && (
              <p className="mt-3 text-sm text-muted-foreground">
                {system.description}
              </p>
            )}
            <span className="mt-6 flex min-h-11 items-center gap-2 font-medium text-primary">
              عرض الخطط والاشتراك
              <ArrowLeft aria-hidden="true" className="size-4" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
