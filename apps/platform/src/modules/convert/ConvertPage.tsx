import { useI18n } from '../../lib/i18n'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { DropZone } from './DropZone'
import { ConvertOptions } from './ConvertOptions'
import { useConvert } from './useConvert'
import { LibraryPanel } from '../library/LibraryPanel'

export function ConvertPage() {
  const { t } = useI18n()
  const c = useConvert()

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
      <section aria-labelledby="upload-heading" className="lg:col-span-7">
        <p className="label">{t('upload.step')}</p>
        <h1
          id="upload-heading"
          className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl"
        >
          {t('upload.titleA')}
          <br />
          <span className="text-fg-soft">{t('upload.titleB')}</span>
        </h1>
        <p className="mt-5 max-w-md text-fg-soft">
          {t('upload.subtitle')}
        </p>

        <form onSubmit={c.onSubmit} className="mt-10">
          <DropZone file={c.file} onPick={c.pick} />

          <ConvertOptions
            scanImages={c.scanImages}
            onScanImages={c.setScanImages}
            extractImages={c.extractImages}
            onExtractImages={c.setExtractImages}
            ocrImages={c.ocrImages}
            onOcrImages={c.setOcrImages}
            ocrScope={c.ocrScope}
            onOcrScope={c.setOcrScope}
            file={c.file}
          />

          <div aria-live="polite" className="mt-4 min-h-6 text-sm">
            {c.error && <Alert className="px-3 py-2">{c.error}</Alert>}
            {c.cancelled && !c.error && (
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-fg-soft">
                {t('upload.cancelled')}
              </p>
            )}
            {c.pending && !c.error && (
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-fg-soft">
                  <Spinner className="h-4 w-4" />
                  {c.progress ?? t('upload.pendingMsg')}
                </p>
                {c.currentJobId && (
                  <button
                    type="button"
                    onClick={c.onCancel}
                    disabled={c.cancelling}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    {c.cancelling ? t('upload.cancelling') : t('upload.cancel')}
                  </button>
                )}
              </div>
            )}
          </div>

          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={c.pending || !c.file}
            aria-busy={c.pending}
            className="mt-2 w-full disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
          >
            {c.pending
              ? t('upload.submitBusy')
              : c.file
                ? t('upload.submitConvert')
                : t('upload.submitIdle')}
          </Button>
        </form>
      </section>

      <LibraryPanel />
    </div>
  )
}
