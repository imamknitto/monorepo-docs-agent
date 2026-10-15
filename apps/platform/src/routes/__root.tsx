import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { AuthControl } from '../components/AuthControl'
import { ConfirmProvider } from '../components/ConfirmDialog'
import { LangSwitch } from '../components/LangSwitch'
import { ThemeToggle } from '../components/ThemeToggle'
import { API_URL } from '../lib/api'
import { useI18n } from '../lib/i18n'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { t } = useI18n()
  return (
    <ConfirmProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
        >
          {t('common.skipContent')}
        </a>
        <header className="shrink-0 border-b border-line bg-bg">
          <div className="mx-auto flex h-14 max-w-[96rem] items-center justify-between px-5 sm:px-8">
            <Link to="/" className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0a0a0a" strokeWidth="3.5">
                  <path d="M7 4v16M17 4v16M7 12h10" />
                </svg>
              </span>
              <span className="text-[15px] font-semibold tracking-tight">halodocs</span>
            </Link>
            <div className="flex items-center gap-4">
              <a
                href={`${API_URL}/health`}
                target="_blank"
                rel="noreferrer"
                className="label hover:text-fg"
              >
                {t('common.apiStatus')}
              </a>
              <LangSwitch />
              <ThemeToggle />
              <AuthControl />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col overflow-y-auto px-5 py-10 sm:px-8">
          <Outlet />
        </main>
        <footer className="shrink-0 border-t border-line">
          <p className="label mx-auto max-w-[96rem] px-5 py-4 sm:px-8">
            {t('common.footerExpiry')}
          </p>
        </footer>
      </div>
    </ConfirmProvider>
  )
}
