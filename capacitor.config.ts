import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unimate.app',
  appName: 'Unimate',
  webDir: 'dist',
  backgroundColor: '#F2F4F8',
  android: {
    allowMixedContent: true,
    captureInput: false,
    webContentsDebuggingEnabled: false
  },
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: { backgroundColor: '#2E5AAC', launchShowDuration: 1200 },
    LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#2E5AAC' }
  }
};

export default config;
