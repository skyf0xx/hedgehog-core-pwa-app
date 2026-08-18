export default function OfflinePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-muted-foreground text-sm">
        This app works offline for anything already loaded, but this page hasn&apos;t been cached
        yet. Reconnect and try again.
      </p>
    </main>
  );
}
