import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.coreops.app',
  appName: 'CoreOps',
  webDir: 'dist',
  // Native HTTP avoids WebView CORS and mixed-content blocks when the API is
  // reached over plain http on the home network.
  plugins: { CapacitorHttp: { enabled: true } },
}

export default config
