export const API_URL =
  import.meta.env?.VITE_API_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8377'

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

export function errDetail(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as { detail?: string }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    /* not JSON — use raw text */
  }
  return text || fallback
}
