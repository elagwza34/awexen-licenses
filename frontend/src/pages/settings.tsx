import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/state';
import { Input, Label } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import type { Setting } from '@/types';
import { clearSavedDraft } from '@/lib/settings-drafts';

const GROUP_LABELS: Record<string, string> = {
  company: 'بيانات الشركة',
  billing: 'الفوترة',
  license: 'قواعد الترخيص',
  security: 'الأمان',
  notifications: 'الإشعارات',
  system: 'النظام',
};

/** Only these types are editable from the panel. */
const EDITABLE_TYPES = new Set(['STRING', 'NUMBER', 'BOOLEAN']);

export function SettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ data: Setting[] }>('/settings'),
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: ({ setting, draft }: { setting: Setting; draft: string }) => {
      if (setting.type === 'NUMBER' && (draft.trim() === '' || !Number.isFinite(Number(draft)) || Number(draft) < 0))
        throw new Error('أدخل رقمًا صالحًا غير سالب قبل الحفظ.');
      return api.put<Setting>(`/settings/${encodeURIComponent(setting.key)}`, {
        value: setting.type === 'NUMBER' ? Number(draft) : setting.type === 'BOOLEAN' ? draft === 'true' : draft,
      });
    },
    onSuccess: (updated, { setting, draft }) => {
      queryClient.setQueryData<{ data: Setting[] }>(['settings'], current => current && ({
        ...current, data: current.data.map(item => item.key === setting.key ? updated : item),
      }));
      // Clear only the value just saved. Other rows and edits typed while the
      // request was pending survive both the response and background refetch.
      setDrafts(current => clearSavedDraft(current, setting.key, draft));
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('تم الحفظ', setting.labelAr || setting.label || undefined);
    },
    onError: (error) => toast.error('تعذّر الحفظ', error instanceof ApiError ? error.friendlyMessage : error.message),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل الإعدادات"
        description={(query.error as ApiError).friendlyMessage}
        onRetry={() => query.refetch()}
      />
    );
  }

  const groups = new Map<string, Setting[]>();
  for (const setting of query.data?.data ?? []) {
    if (!groups.has(setting.group)) groups.set(setting.group, []);
    groups.get(setting.group)!.push(setting);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">
          قواعد الترخيص قابلة للتعديل من هنا وتُطبَّق فورًا بدون إعادة تشغيل
        </p>
      </header>

      {Array.from(groups.entries()).map(([group, settings]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{GROUP_LABELS[group] ?? group}</CardTitle>
            <CardDescription>كل تعديل هنا يُسجَّل في سجل التدقيق</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings.map((setting) => {
              const readOnly = !EDITABLE_TYPES.has(setting.type) || setting.isSensitive;
              const draft = drafts[setting.key] ?? String(setting.value ?? '');
              return (
                <div
                  key={setting.key}
                  className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium">
                      {setting.labelAr || setting.label}
                    </Label>
                    <p className="ltr text-[11px] text-muted-foreground">{setting.key}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {readOnly ? (
                      <span className="ltr rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                        {setting.isSensitive ? 'محمي' : String(setting.value)}
                      </span>
                    ) : (
                      <>
                        {setting.type === 'BOOLEAN' ? (
                          <select
                            value={draft || 'false'}
                            onChange={(event) =>
                              setDrafts(current => ({ ...current, [setting.key]: event.target.value }))
                            }
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            aria-label={setting.label ?? setting.key}
                          >
                            <option value="true">مفعّل</option>
                            <option value="false">معطّل</option>
                          </select>
                        ) : (
                          <Input
                            type={setting.type === 'NUMBER' ? 'number' : 'text'}
                            value={draft}
                            onChange={(event) =>
                              setDrafts(current => ({ ...current, [setting.key]: event.target.value }))
                            }
                            dir={setting.type === 'NUMBER' ? 'ltr' : undefined}
                            className={`w-40 ${setting.type === 'NUMBER' ? 'text-start' : ''}`}
                            aria-label={setting.label ?? setting.key}
                          />
                        )}
                        {can('settings.update') && (
                          <Button
                            size="sm"
                            variant="outline"
                            isLoading={save.isPending && save.variables?.setting.key === setting.key}
                            disabled={save.isPending || draft === String(setting.value ?? '')}
                            onClick={() => save.mutate({ setting, draft })}
                          >
                            <Save />
                            حفظ
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
