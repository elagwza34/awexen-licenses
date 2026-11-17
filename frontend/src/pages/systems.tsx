import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SoftwareSystem } from "@/lib/portal-api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function SystemsPage() {
  const client = useQueryClient(),
    { can } = useAuth();
  const systems = useQuery({
    queryKey: ["systems"],
    queryFn: () => api.get<{ data: SoftwareSystem[] }>("/systems"),
  });
  const [editing, setEditing] = useState<SoftwareSystem | null>(null),
    [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    key: "",
    name: "",
    nameAr: "",
    description: "",
    active: true,
  });
  const save = useMutation({
    mutationFn: () => {
      const { key, ...body } = form;
      return editing
        ? api.put("/systems/" + editing.id, body)
        : api.post("/systems", { ...body, key: key.trim().toUpperCase() });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["systems"] });
      client.invalidateQueries({ queryKey: ["portal"] });
      setOpen(false);
    },
  });
  const start = (system: SoftwareSystem | null) => {
    setEditing(system);
    setForm({
      key: system?.key ?? "",
      name: system?.name ?? "",
      nameAr: system?.nameAr ?? "",
      description: system?.description ?? "",
      active: system?.active ?? true,
    });
    save.reset();
    setOpen(true);
  };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">الأنظمة</h1>
          <p className="mt-2 text-muted-foreground">
            أضف الأنظمة التي تظهر في كتالوج العميل، ثم اربط خططها بها.
          </p>
        </div>
        {can("plans.create") && (
          <Button className="min-h-11 min-w-11" onClick={() => start(null)}>
            إضافة نظام
          </Button>
        )}
      </header>
      {systems.isLoading && <p role="status">جارٍ تحميل الأنظمة…</p>}
      {systems.isError && (
        <p role="alert">
          تعذر تحميل الأنظمة.{" "}
          <Button
            className="min-h-11 min-w-11"
            onClick={() => systems.refetch()}
          >
            إعادة المحاولة
          </Button>
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {systems.data?.data.map((system) => (
          <Card key={system.id}>
            <CardHeader>
              <CardTitle>{system.nameAr}</CardTitle>
              <p>
                {system.name} ·{" "}
                {system.active ? "ظاهر للعملاء" : "مخفي من الكتالوج"}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>{system.description}</p>
              {can("plans.update") && (
                <Button
                  className="min-h-11 min-w-11"
                  variant="outline"
                  onClick={() => start(system)}
                >
                  تعديل النظام
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => !save.isPending && setOpen(value)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل النظام" : "إضافة نظام"}</DialogTitle>
            <DialogDescription>
              إخفاء النظام يمنع الشراء الجديد ويحافظ على اشتراكات العملاء
              وتراخيصهم.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div>
              <Label htmlFor="system-key">المفتاح</Label>
              <Input
                id="system-key"
                dir="ltr"
                required
                maxLength={60}
                pattern="[A-Z][A-Z0-9_]{1,59}"
                disabled={!!editing || save.isPending}
                value={form.key}
                onChange={(e) =>
                  setForm({ ...form, key: e.target.value.toUpperCase() })
                }
              />
            </div>
            <div>
              <Label htmlFor="system-ar">اسم النظام بالعربية</Label>
              <Input
                id="system-ar"
                required
                maxLength={120}
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="system-en">اسم النظام بالإنجليزية</Label>
              <Input
                id="system-en"
                dir="ltr"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="system-description">الوصف</Label>
              <Textarea
                id="system-description"
                maxLength={2000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              إظهار في كتالوج العميل
            </label>
            {save.isError && (
              <p role="alert" className="text-destructive">
                {(save.error as Error).message}
              </p>
            )}
            <Button
              className="min-h-11 min-w-11"
              type="submit"
              disabled={save.isPending}
            >
              {save.isPending ? "جارٍ الحفظ…" : "حفظ النظام"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
