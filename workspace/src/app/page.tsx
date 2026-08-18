import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>App shell ready</CardTitle>
          <CardDescription>
            No feature modules yet — this is the empty, buildable pwa-app core shell.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Add a domain module under <code>src/features/</code> to get started.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
