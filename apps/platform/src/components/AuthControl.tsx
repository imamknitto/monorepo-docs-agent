import { Link } from '@tanstack/react-router'
import { signOut, useSession } from '../lib/auth'
import { useI18n } from '../lib/i18n'

/** Header session control: sign-in link for guests, name + sign-out when logged in. */
export function AuthControl() {
  const { t } = useI18n()
  const { data: session, isPending } = useSession()

  if (isPending) return null

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="label transition-colors hover:text-fg">
          {t('ws.back')}
        </Link>
        <span className="label hidden max-w-[12rem] truncate sm:inline">
          {session.user.name || session.user.email}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="label transition-colors hover:text-fg"
        >
          {t('auth.signOut')}
        </button>
      </div>
    )
  }

  return (
    <Link to="/login" className="label transition-colors hover:text-fg">
      {t('auth.signIn')}
    </Link>
  )
}
