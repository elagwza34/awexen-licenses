import { Construction } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Honest placeholder for Phase 2 modules.
 *
 * The route exists so navigation is complete, but the screen says plainly that
 * it is not implemented rather than rendering fabricated data.
 */
export function PlaceholderPage({ title, phase }: { title: string; phase?: string }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Construction className="h-5 w-5 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>
          {phase ? `المرحلة ${phase}` : 'قريبًا'} — الواجهة الخلية (API) جاهزة، والواجهة الأمامية قيد التنفيذ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          هذه الشاشة لم تُبنَ بعد. لن يتم عرض أي بيانات وهمية هنا — عندما تكتمل الوحدة ستعمل على بيانات حقيقية
          من قاعدة البيانات مباشرة.
        </p>
        <p className="ltr text-xs">Module pending: {title}</p>
      </CardContent>
    </Card>
  );
}
