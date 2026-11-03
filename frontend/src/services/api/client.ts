import { ApiError, toApiError, type ApiSuccess } from './errors'

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

type RefreshResult = 'ok' | 'unauthorized' | 'network'

let csrfToken: string | null = null
let refreshPromise: Promise<RefreshResult> | null = null
let unauthorizedHandler: (() => void) | null = null

const refreshSkipped = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/register',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/csrf',
])

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function clearCsrf() {
  csrfToken = null
}

export async function ensureCsrf(force = false): Promise<void> {
  if (csrfToken && !force) {
    return
  }
  const response = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw await toApiError(response)
  }
  const body = (await response.json()) as ApiSuccess<{ csrf_token: string }>
  csrfToken = body.data.csrf_token
}

async function refreshSession(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = (async (): Promise<RefreshResult> => {
      try {
        if (!csrfToken) {
          await ensureCsrf()
        }
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken
        }
        let response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers,
        })
        // Backend mid-reload can fail CSRF once — refresh token and retry once.
        if (response.status === 403) {
          const error = await toApiError(response)
          if (error.code === 'CSRF_VALIDATION_FAILED') {
            csrfToken = null
            await ensureCsrf()
            const retryHeaders: Record<string, string> = { Accept: 'application/json' }
            if (csrfToken) retryHeaders['X-CSRF-Token'] = csrfToken
            response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
              headers: retryHeaders,
            })
          } else {
            // Not a real logout — treat as brief outage (uvicorn reload).
            return 'network'
          }
        }
        if (response.ok) return 'ok'
        // Only a true 401 means the session is gone.
        if (response.status === 401) return 'unauthorized'
        return 'network'
      } catch {
        return 'network'
      }
    })().finally(() => {
      refreshPromise = null
    }) as Promise<RefreshResult>
  }
  return refreshPromise
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  allowRetry = true,
  formData = false,
): Promise<ApiSuccess<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined && !formData) {
    headers['Content-Type'] = 'application/json'
  }
  if (method !== 'GET' && method !== 'HEAD') {
    if (!csrfToken) {
      await ensureCsrf()
    }
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken
    }
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body:
        body === undefined
          ? undefined
          : formData
            ? (body as FormData)
            : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0, 'NETWORK_ERROR')
  }

  if (response.status === 403 && allowRetry) {
    const error = await toApiError(response)
    if (error.code === 'CSRF_VALIDATION_FAILED') {
      csrfToken = null
      await ensureCsrf()
      return request(method, path, body, false, formData)
    }
    throw error
  }

  if (response.status === 401 && allowRetry && !refreshSkipped.has(path.split('?')[0] ?? path)) {
    const refreshed = await refreshSession()
    if (refreshed === 'ok') {
      return request(method, path, body, false, formData)
    }
    if (refreshed === 'unauthorized') {
      unauthorizedHandler?.()
      throw await toApiError(response)
    }
    // Backend briefly down (e.g. uvicorn --reload): keep the session, surface a network error.
    throw new ApiError(
      'Server is temporarily unavailable. Retry in a moment — you are still signed in.',
      0,
      'NETWORK_ERROR',
    )
  }

  if (!response.ok) {
    throw await toApiError(response)
  }
  if (response.status === 204) {
    return { data: undefined as T, message: '' }
  }
  return (await response.json()) as ApiSuccess<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  postForm: <T>(path: string, body: FormData) => request<T>('POST', path, body, true, true),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
