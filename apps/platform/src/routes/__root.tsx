import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="text-lg font-semibold">Markitdown</p>
          <p className="text-sm text-zinc-500">PDF to Markdown</p>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 text-sm text-zinc-500">
          Converted documents expire automatically (default 60 min).
        </div>
      </footer>
    </div>
  )
}
