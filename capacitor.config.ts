import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.once11.app',
  appName: 'Once 11',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*.tunnelmole.net',
      '*.loca.lt',
      '*.trycloudflare.com',
      'raw.githubusercontent.com',
      '192.168.1.27',
    ],
  },
};

export default config;
