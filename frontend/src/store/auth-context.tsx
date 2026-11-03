/* The provider, hook, and context live together so authentication state has one owner. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { LoginInput, RegisterInput, UserProfile } from '../auth/types'
import { ApiError } from '../services/api/errors'
import { api, clearCsrf, ensureCsrf, setUnauthorizedHandler } from '../services/api/client'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  user: UserProfile | null
  login: (input: LoginInput) => Promise<UserProfile>
  register: (input: RegisterInput) => Promise<string>
  logout: () => Promise<void>
  refreshUser: () => Promise<UserProfile | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<UserProfile | null>(null)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      setStatus('unauthenticated')
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function readMe() {
      await ensureCsrf()
      return api.get<UserProfile>('/api/v1/auth/me')
    }
    async function bootstrap() {
      try {
        const result = await readMe()
        if (!cancelled) {
          setUser(result.data)
          setStatus('authenticated')
        }
      } catch (firstError) {
        // Backend reload / short outage: retry once before treating as logged out.
        const network =
          firstError instanceof ApiError &&
          (firstError.code === 'NETWORK_ERROR' || firstError.status === 0)
        if (network && !cancelled) {
          try {
            await new Promise((resolve) => window.setTimeout(resolve, 900))
            const result = await readMe()
            if (!cancelled) {
              setUser(result.data)
              setStatus('authenticated')
            }
            return
          } catch {
            /* fall through */
          }
        }
        if (!cancelled) {
          setUser(null)
          setStatus('unauthenticated')
        }
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    await ensureCsrf(true)
    const result = await api.post<UserProfile>('/api/v1/auth/login', input)
    setUser(result.data)
    setStatus('authenticated')
    return result.data
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    await ensureCsrf(true)
    const result = await api.post<UserProfile>('/api/v1/auth/register', input)
    return result.message
  }, [])

  const logout = useCallback(async () => {
    try {
      await ensureCsrf(true)
      await api.post<undefined>('/api/v1/auth/logout')
    } finally {
      clearCsrf()
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const result = await api.get<UserProfile>('/api/v1/auth/me')
      setUser(result.data)
      setStatus('authenticated')
      return result.data
    } catch {
      setUser(null)
      setStatus('unauthenticated')
      return null
    }
  }, [])

  const value = useMemo(
    () => ({ status, user, login, register, logout, refreshUser }),
    [status, user, login, register, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return value
}

export { AuthContext }
