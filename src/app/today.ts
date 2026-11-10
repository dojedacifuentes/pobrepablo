import { useEffect, useState } from 'react'
import { type Environment, systemEnvironment } from '@/data'
import type { LocalDate } from '@/domain'

/** The real clock of the app. The domain never reads it: it is handed «today» from here. */
export const environment: Environment = systemEnvironment()

/**
 * Today's calendar day in Chile. It is checked again when the app comes back to the front and
 * once a minute, so that an app left open overnight wakes up on the right day.
 */
export function useToday(): LocalDate {
  const [today, setToday] = useState<LocalDate>(() => environment.today())

  useEffect(() => {
    const check = (): void => setToday(environment.today())
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return today
}
