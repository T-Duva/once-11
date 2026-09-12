import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.once11.app',
  appName: 'Once 11',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*.tunnelmole.net',
      '*.loca.lt',
      '*.trycloudflare.com',
      'api.github.com',
      'raw.githubusercontent.com',
      'cdn.jsdelivr.net',
      'github.com',
      '*.githubusercontent.com',
      '192.168.1.27',
    ],
  },
  plugins: {
    // Obligatorio en Android: sin esto el WebView no llega bien a los túneles.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
