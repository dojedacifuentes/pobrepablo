import { defineConfig } from '@playwright/test'

/** Viewports móviles de la especificación §5.1 (px CSS). 390×844 es la referencia. */
const mobileViewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
] as const

const port = 4173

export default defineConfig({
  testDir: 'e2e',
  // The screenshots have their own configuration: npm run capturas.
  testIgnore: 'capturas/**',
  fullyParallel: true,
  // Eight browsers at once starve WebKit on this computer until its pages crash.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(port)}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
  },
  projects: [
    ...mobileViewports.map((viewport) => ({
      name: `movil-${viewport.name}`,
      use: {
        browserName: 'chromium' as const,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    })),
    // WebKit is the engine of Safari on the iPhone. This emulates it; it is not a real phone.
    ...[mobileViewports[0], mobileViewports[3]].map((viewport) => ({
      name: `webkit-${viewport.name}`,
      use: {
        browserName: 'webkit' as const,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    })),
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
