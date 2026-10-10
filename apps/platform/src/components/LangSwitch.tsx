import { useI18n } from '../lib/i18n'

export function LangSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div
      role="group"
      aria-label={t('lang.label')}
      className="flex overflow-hidden rounded-md border border-line text-xs font-medium"
    >
      {(['id', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          title={l === 'id' ? t('lang.id') : t('lang.en')}
          className={`px-2.5 py-1.5 uppercase transition-colors ${
            lang === l
              ? 'bg-surface-2 text-fg'
              : 'text-fg-faint hover:text-fg'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
