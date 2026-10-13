import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'id'

const STORAGE_KEY = 'halodocs:lang'

const en = {
  'common.skipContent': 'Skip to content',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.apiStatus': 'API status',
  'common.footerExpiry': 'Documents expire automatically (default 60 min)',
  'common.convertAnother': 'Convert another file',
  'common.unknownError': 'Something went wrong.',

  'upload.step': '01 / Convert',
  'upload.titleA': 'PDF to Markdown,',
  'upload.titleB': 'tables and images intact.',
  'upload.subtitle': 'Upload a PDF, get structured Markdown back, then ask questions against the document.',
  'upload.dropAria': 'Drop a PDF here or press Enter to browse',
  'upload.dropTitle': 'Drop a PDF here, or',
  'upload.browse': 'browse',
  'upload.dropHint': 'PDF only · max 30 MB',
  'upload.fileReplace': 'click or drop to replace',
  'upload.errPdfOnly': 'Only PDF files are supported in v1.',
  'upload.errTooBig': '“{name}” is {size} — the limit is 30 MB.',
  'upload.errNoFile': 'Choose a PDF file first.',
  'upload.submitConvert': 'Convert to Markdown',
  'upload.submitIdle': 'Choose a PDF to begin',
  'upload.submitBusy': 'Converting…',
  'upload.pendingMsg': 'Converting — tables and images take a moment…',
  'upload.asyncQueued': 'Large file — queued for background conversion…',
  'upload.asyncProcessing': 'Converting in background — page {done}{total}…',
  'upload.asyncFallback': 'Direct conversion timed out — retrying in background…',
  'upload.cancel': 'Cancel',
  'upload.cancelled': 'Conversion cancelled',
  'upload.cancelConfirm': 'Cancel this conversion?',
  'upload.cancelling': 'Cancelling…',
  'upload.resumed': 'Resuming background conversion…',
  'upload.jobExpired': 'That conversion is no longer available (expired). Please start again.',

  'options.scanTitle': 'OCR scanned pages',
  'options.scanDesc': 'Slower; downloads the OCR model once (needs internet).',
  'options.scanEffect': 'Effect: full-page scans are rendered and OCR’d into page text. Small figures on normal pages are ignored.',
  'options.imgTitle': 'Include images',
  'options.imgDesc': 'Extract embedded figures and scans into the Markdown. Turn off for text-only output.',
  'options.imgEffect': 'Effect: figures are saved and linked as images in the Markdown. Off = text-only, no figure OCR.',
  'options.ocrTitle': 'OCR embedded figures',
  'options.ocrDesc': 'Read text inside diagrams and flowcharts (e.g. BRD) so chat can answer about them. Slower on image-heavy PDFs.',
  'options.ocrEffect': 'Effect: each extracted figure gets an “OCR:” text block under its link. Requires Include images — auto-enabled when ticked.',
  'options.ocrHeavyWarn': 'A {size} file + OCR can take many minutes — conversion will run in the background with progress.',
  'options.scopeLabel': 'OCR scope',
  'options.scopeAll': 'All figures',
  'options.scopeFlowchart': 'Flowcharts only',

  'library.step': '02 / Library',
  'library.title': 'Available documents',
  'library.refresh': 'Refresh',
  'library.refreshing': 'Refreshing…',
  'library.loading': 'Loading documents…',
  'library.empty': 'No converted documents yet. Upload a PDF to create the first one.',
  'library.deleteTitle': 'Delete this document?',
  'library.deleteDesc': 'The markdown, chat sessions, vector index, and images will be permanently removed. This cannot be undone.',
  'library.deleting': '…',

  'result.back': 'All documents',
  'result.download': 'Download .md',
  'result.copy': 'Copy markdown',
  'result.copied': 'Copied',
  'result.delete': 'Delete',
  'result.deleting': 'Deleting…',
  'result.viewLabel': 'Document view',
  'result.preview': 'Preview',
  'result.source': 'Markdown source',
  'result.headsUp': 'Heads up',
  'result.details': 'Document details',
  'result.detailsWarnings': '· {n} warnings',
  'result.autoDelete': 'Auto-delete',
  'result.autoDeleteAt': 'at {time} ({remain})',
  'result.autoDeleteDefault': 'about 1 hour after upload',
  'result.autoDeleteNote': 'Document, chat sessions, vector index and images are removed permanently.',
  'result.titleDefault': 'Conversion result',
  'result.expiresPrefix': 'expires',
  'result.statPages': 'Pages',
  'result.statTables': 'Tables',
  'result.statImages': 'Images',
  'result.statScanned': 'Scanned',
  'result.statSkipped': 'Skipped',
  'result.statLabel': 'Document statistics',
  'result.errLoad': 'Could not load the document.',
  'result.loadingDoc': 'Loading your document…',
  'result.deleteTitle': 'Delete this document?',
  'result.deleteDesc': 'The markdown, chat sessions, vector index, and images will be permanently removed. This cannot be undone.',
  'result.errDelete': 'Could not delete the document.',
  'result.remainNow': 'any moment now',
  'result.remainSoon': 'in less than a minute',
  'result.remainMin': 'in ~{mins} min',
  'result.remainHM': 'in ~{h}h {m}m',

  'chat.title': 'Ask this document',
  'chat.checking': 'Checking index…',
  'chat.expired': 'Expired — auto-deleted',
  'chat.indexing': 'Indexing…',
  'chat.indexed': 'Indexed · {pages} pages',
  'chat.sessionLabel': 'Chat session',
  'chat.sessionName': 'Chat {n}',
  'chat.new': 'New',
  'chat.delete': 'Delete',
  'chat.goneEmpty': 'This document expired or was deleted — its chat history is gone.',
  'chat.indexingEmpty': 'Preparing the document index…',
  'chat.emptyTitle': 'Ask anything about this document.',
  'chat.sug1': 'Summarize this document',
  'chat.sug2': 'What are the key points?',
  'chat.sug3': 'What do the tables contain?',
  'chat.you': 'You',
  'chat.assistant': 'Assistant',
  'chat.thinking': 'Thinking',
  'chat.input': 'Input',
  'chat.output': 'Output',
  'chat.running': 'running',
  'chat.done': 'done',
  'chat.toolError': 'error',
  'chat.copyAnswer': 'Copy answer',
  'chat.copied': 'Copied',
  'chat.scrollLatest': 'Scroll to latest message',
  'chat.generating': 'Generating…',
  'chat.placeholder': 'Ask a question…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.docGone': 'Document expired or deleted.',
  'chat.waitingIndex': 'Waiting for index…',
  'chat.loadingHistory': 'Loading history…',
  'chat.resetIdentity': 'Reset identity',
  'chat.debugTitle': 'Indexing debug (polls: {polls}) — click to diagnose stuck index',
  'chat.debugHelp': 'If this never finishes, the worker likely never picked up the job. Check: 1) API log [index:enqueue], 2) worker log [worker:start] → [worker:done], 3) embedding log [rag:index] (embedding failure alone does NOT block indexing).',
  'chat.debugCheck': 'Check why stuck (GET /v1/debug/:docId)',
  'chat.debugChecking': 'Checking…',
  'chat.goneNote': 'This document expired or was deleted. The markdown, chat sessions, and vector index were automatically removed.',
  'chat.deleteChatTitle': 'Delete this chat?',
  'chat.deleteChatDesc': 'The messages in this chat session will be permanently removed.',
  'chat.resetTitle': 'Reset browser identity?',
  'chat.resetDesc': 'You will lose access to all chat history made from this browser.',
  'chat.resetConfirm': 'Reset',
  'chat.errChat': 'Chat failed.',
  'chat.errChatHttp': 'Chat failed (HTTP {status}).',
  'chat.errHistory': 'Could not load history.',
  'chat.errStatus': 'Status failed.',

  'theme.toLight': 'Switch to light theme',
  'theme.toDark': 'Switch to dark theme',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.id': 'Indonesian',

  'toc.title': 'On this page',
  'result.tocToggle': 'Contents',
  'mdview.copy': 'Copy',
  'mdview.copied': 'Copied',

  'api.errConvert': 'Conversion failed (HTTP {status})',
  'api.errConvertGeneric': 'Conversion failed.',
  'api.errConvertTimeout': 'Conversion is taking too long — try background mode or turn off image OCR.',
  'api.errDocs': 'Could not load documents (HTTP {status}).',
  'api.errDeleteDoc': 'Could not delete document (HTTP {status}).',
  'api.errMarkdown': 'Markdown not found or expired.',
} as const

export type StringKey = keyof typeof en

const id: Record<StringKey, string> = {
  'common.skipContent': 'Lewati ke konten',
  'common.cancel': 'Batal',
  'common.delete': 'Hapus',
  'common.apiStatus': 'Status API',
  'common.footerExpiry': 'Dokumen kedaluwarsa otomatis (default 60 mnt)',
  'common.convertAnother': 'Konversi file lain',
  'common.unknownError': 'Terjadi kesalahan.',

  'upload.step': '01 / Konversi',
  'upload.titleA': 'PDF ke Markdown,',
  'upload.titleB': 'tabel dan gambar tetap utuh.',
  'upload.subtitle': 'Unggah PDF, dapatkan Markdown terstruktur, lalu tanyakan apa pun tentang dokumen.',
  'upload.dropAria': 'Jatuhkan PDF di sini atau tekan Enter untuk telusuri',
  'upload.dropTitle': 'Jatuhkan PDF di sini, atau',
  'upload.browse': 'telusuri',
  'upload.dropHint': 'Hanya PDF · maks 30 MB',
  'upload.fileReplace': 'klik atau jatuhkan untuk mengganti',
  'upload.errPdfOnly': 'Hanya file PDF yang didukung di v1.',
  'upload.errTooBig': '“{name}” berukuran {size} — batasnya 30 MB.',
  'upload.errNoFile': 'Pilih file PDF dulu.',
  'upload.submitConvert': 'Konversi ke Markdown',
  'upload.submitIdle': 'Pilih PDF untuk memulai',
  'upload.submitBusy': 'Mengonversi…',
  'upload.pendingMsg': 'Mengonversi — tabel dan gambar butuh sesaat…',
  'upload.asyncQueued': 'File besar — masuk antrean konversi latar…',
  'upload.asyncProcessing': 'Mengonversi di latar — halaman {done}{total}…',
  'upload.asyncFallback': 'Konversi langsung timeout — mengulang di latar…',
  'upload.cancel': 'Batal',
  'upload.cancelled': 'Konversi dibatalkan',
  'upload.cancelConfirm': 'Batalkan konversi ini?',
  'upload.cancelling': 'Membatalkan…',
  'upload.resumed': 'Melanjutkan konversi latar…',
  'upload.jobExpired': 'Konversi itu sudah tidak tersedia (kadaluarsa). Silakan mulai lagi.',

  'options.scanTitle': 'OCR halaman hasil scan',
  'options.scanDesc': 'Lebih lambat; mengunduh model OCR sekali (butuh internet).',
  'options.scanEffect': 'Efek: halaman hasil scan penuh di-render dan di-OCR menjadi teks halaman. Gambar kecil di halaman normal diabaikan.',
  'options.imgTitle': 'Sertakan gambar',
  'options.imgDesc': 'Ekstrak gambar dan hasil scan ke dalam Markdown. Matikan untuk output teks saja.',
  'options.imgEffect': 'Efek: gambar disimpan dan ditautkan di Markdown. Mati = hanya teks, tanpa OCR gambar.',
  'options.ocrTitle': 'OCR gambar di dalam dokumen',
  'options.ocrDesc': 'Baca teks di dalam diagram dan flowchart (mis. BRD) agar chat bisa menjawab tentangnya. Lebih lambat pada PDF yang banyak gambar.',
  'options.ocrEffect': 'Efek: tiap gambar hasil ekstraksi mendapat blok teks “OCR:” di bawah tautannya. Butuh Sertakan gambar — otomatis aktif saat dicentang.',
  'options.ocrHeavyWarn': 'File {size} + OCR bisa memakan waktu belasan menit — konversi otomatis jalan di latar dengan progres.',
  'options.scopeLabel': 'Cakupan OCR',
  'options.scopeAll': 'Semua gambar',
  'options.scopeFlowchart': 'Hanya flowchart',

  'library.step': '02 / Pustaka',
  'library.title': 'Dokumen tersedia',
  'library.refresh': 'Muat ulang',
  'library.refreshing': 'Memuat ulang…',
  'library.loading': 'Memuat dokumen…',
  'library.empty': 'Belum ada dokumen hasil konversi. Unggah PDF untuk membuat yang pertama.',
  'library.deleteTitle': 'Hapus dokumen ini?',
  'library.deleteDesc': 'Markdown, sesi chat, indeks vektor, dan gambar akan dihapus permanen. Tidak dapat dibatalkan.',
  'library.deleting': '…',

  'result.back': 'Semua dokumen',
  'result.download': 'Unduh .md',
  'result.copy': 'Salin markdown',
  'result.copied': 'Tersalin',
  'result.delete': 'Hapus',
  'result.deleting': 'Menghapus…',
  'result.viewLabel': 'Tampilan dokumen',
  'result.preview': 'Pratinjau',
  'result.source': 'Sumber Markdown',
  'result.headsUp': 'Perhatian',
  'result.details': 'Detail dokumen',
  'result.detailsWarnings': '· {n} peringatan',
  'result.autoDelete': 'Hapus otomatis',
  'result.autoDeleteAt': 'pada {time} ({remain})',
  'result.autoDeleteDefault': 'sekitar 1 jam setelah diunggah',
  'result.autoDeleteNote': 'Dokumen, sesi chat, indeks vektor, dan gambar dihapus permanen.',
  'result.titleDefault': 'Hasil konversi',
  'result.expiresPrefix': 'kedaluwarsa',
  'result.statPages': 'Halaman',
  'result.statTables': 'Tabel',
  'result.statImages': 'Gambar',
  'result.statScanned': 'Hasil scan',
  'result.statSkipped': 'Dilewati',
  'result.statLabel': 'Statistik dokumen',
  'result.errLoad': 'Tidak dapat memuat dokumen.',
  'result.loadingDoc': 'Memuat dokumen…',
  'result.deleteTitle': 'Hapus dokumen ini?',
  'result.deleteDesc': 'Markdown, sesi chat, indeks vektor, dan gambar akan dihapus permanen. Tidak dapat dibatalkan.',
  'result.errDelete': 'Tidak dapat menghapus dokumen.',
  'result.remainNow': 'sewaktu-waktu',
  'result.remainSoon': 'dalam waktu kurang dari satu menit',
  'result.remainMin': 'dalam ~{mins} mnt',
  'result.remainHM': 'dalam ~{h} jam {m} mnt',

  'chat.title': 'Tanya dokumen ini',
  'chat.checking': 'Memeriksa indeks…',
  'chat.expired': 'Kedaluwarsa — terhapus otomatis',
  'chat.indexing': 'Mengindeks…',
  'chat.indexed': 'Terindeks · {pages} halaman',
  'chat.sessionLabel': 'Sesi chat',
  'chat.sessionName': 'Chat {n}',
  'chat.new': 'Baru',
  'chat.delete': 'Hapus',
  'chat.goneEmpty': 'Dokumen ini kedaluwarsa atau dihapus — riwayat chat-nya hilang.',
  'chat.indexingEmpty': 'Menyiapkan indeks dokumen…',
  'chat.emptyTitle': 'Tanyakan apa pun tentang dokumen ini.',
  'chat.sug1': 'Ringkas dokumen ini',
  'chat.sug2': 'Apa poin-poin pentingnya?',
  'chat.sug3': 'Apa isi tabel-tabelnya?',
  'chat.you': 'Anda',
  'chat.assistant': 'Asisten',
  'chat.thinking': 'Berpikir',
  'chat.input': 'Masukan',
  'chat.output': 'Keluaran',
  'chat.running': 'berjalan',
  'chat.done': 'selesai',
  'chat.toolError': 'gagal',
  'chat.copyAnswer': 'Salin jawaban',
  'chat.copied': 'Tersalin',
  'chat.scrollLatest': 'Gulir ke pesan terbaru',
  'chat.generating': 'Menjawab…',
  'chat.placeholder': 'Tulis pertanyaan…',
  'chat.send': 'Kirim',
  'chat.stop': 'Berhenti',
  'chat.docGone': 'Dokumen kedaluwarsa atau dihapus.',
  'chat.waitingIndex': 'Menunggu indeks…',
  'chat.loadingHistory': 'Memuat riwayat…',
  'chat.resetIdentity': 'Atur ulang identitas',
  'chat.debugTitle': 'Debug indeks (poll: {polls}) — klik untuk diagnosa indeks macet',
  'chat.debugHelp': 'Jika tidak pernah selesai, kemungkinan worker tidak mengambil job. Periksa: 1) log API [index:enqueue], 2) log worker [worker:start] → [worker:done], 3) log embedding [rag:index] (kegagalan embedding saja TIDAK menghambat indeks).',
  'chat.debugCheck': 'Cek penyebab macet (GET /v1/debug/:docId)',
  'chat.debugChecking': 'Memeriksa…',
  'chat.goneNote': 'Dokumen ini kedaluwarsa atau dihapus. Markdown, sesi chat, dan indeks vektor telah dihapus otomatis.',
  'chat.deleteChatTitle': 'Hapus chat ini?',
  'chat.deleteChatDesc': 'Pesan-pesan di sesi chat ini akan dihapus permanen.',
  'chat.resetTitle': 'Atur ulang identitas browser?',
  'chat.resetDesc': 'Anda akan kehilangan akses ke semua riwayat chat dari browser ini.',
  'chat.resetConfirm': 'Atur ulang',
  'chat.errChat': 'Chat gagal.',
  'chat.errChatHttp': 'Chat gagal (HTTP {status}).',
  'chat.errHistory': 'Tidak dapat memuat riwayat.',
  'chat.errStatus': 'Status gagal.',

  'theme.toLight': 'Ganti ke tema terang',
  'theme.toDark': 'Ganti ke tema gelap',
  'lang.label': 'Bahasa',
  'lang.en': 'Inggris',
  'lang.id': 'Indonesia',

  'toc.title': 'Di halaman ini',
  'result.tocToggle': 'Daftar isi',
  'mdview.copy': 'Salin',
  'mdview.copied': 'Tersalin',

  'api.errConvert': 'Konversi gagal (HTTP {status})',
  'api.errConvertGeneric': 'Konversi gagal.',
  'api.errConvertTimeout': 'Konversi terlalu lama — coba mode latar atau matikan OCR gambar.',
  'api.errDocs': 'Tidak dapat memuat dokumen (HTTP {status}).',
  'api.errDeleteDoc': 'Tidak dapat menghapus dokumen (HTTP {status}).',
  'api.errMarkdown': 'Markdown tidak ditemukan atau kedaluwarsa.',
}

const dicts: Record<Lang, Record<StringKey, string>> = { en, id }

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'id' || saved === 'en') return saved
  } catch {
    /* storage blocked — fall through to browser detection */
  }
  try {
    if (navigator.language?.toLowerCase().startsWith('id')) return 'id'
  } catch {
    /* ignore */
  }
  return 'en'
}

let current: Lang = detect()
const listeners = new Set<() => void>()

function applyDocumentLang(l: Lang): void {
  try {
    document.documentElement.lang = l === 'id' ? 'id' : 'en'
  } catch {
    /* non-DOM environment */
  }
}

applyDocumentLang(current)

export function getLang(): Lang {
  return current
}

export function setLang(l: Lang): void {
  if (l === current) return
  current = l
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* storage blocked — language still applies for this session */
  }
  applyDocumentLang(l)
  listeners.forEach((fn) => fn())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const table = dicts[current] ?? en
  let s: string = table[key] ?? en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}

export function localeTag(): string {
  return current === 'id' ? 'id-ID' : 'en-US'
}

export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  const lang = useSyncExternalStore(subscribe, getLang, getLang)
  return { lang, setLang, t }
}
