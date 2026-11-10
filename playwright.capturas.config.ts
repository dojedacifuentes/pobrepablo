import { defineConfig } from '@playwright/test'

/**
 * `npm run capturas`: a picture of every screen in every viewport, into `capturas/<pantalla>/`.
 * The six mobile viewports of the specification (§5.1), plus tablet and desktop.
 * The pictures use the Demo profile or an invented test profile: never anybody's real money.
 */
const viewports = [
  { name: '320x568', width: 320, height: 568, mobile: true },
  { name: '360x800', width: 360, height: 800, mobile: true },
  { name: '375x667', width: 375, height: 667, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '412x915', width: 412, height: 915, mobile: true },
  { name: '430x932', width: 430, height: 932, mobile: true },
  { name: '768x1024', width: 768, height: 1024, mobile: false },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
] as const

const port = 4174

export default defineConfig({
  testDir: 'e2e/capturas',
  outputDir: 'test-results/capturas',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(port)}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
  },
  projects: viewports.map((viewport) => ({
    name: viewport.name,
    use: {
      browserName: 'chromium' as const,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      hasTouch: viewport.mobile,
      isMobile: viewport.mobile,
    },
  })),
  webServer: {
    command: `npm run build && npm run preview -- --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
