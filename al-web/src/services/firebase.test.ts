import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  getApp: vi.fn(),
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
}));

const productionConfig = {
  VITE_FIREBASE_API_KEY: 'demo-al-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-al.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-al',
  VITE_FIREBASE_APP_ID: 'demo-al-web',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DEV', false);
  vi.stubEnv('PROD', true);
  for (const [name, value] of Object.entries(productionConfig)) {
    vi.stubEnv(name, value);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('production Firebase configuration', () => {
  it.each(Object.keys(productionConfig))('throws when %s is missing before initializing or connecting emulators', async (name) => {
    vi.stubEnv(name, undefined);

    await expect(import('./firebase')).rejects.toThrow(`Missing required Firebase configuration: ${name}`);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getApp).not.toHaveBeenCalled();
    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('initializes with complete configuration and never connects emulators even when their URLs are set', async () => {
    vi.stubEnv('VITE_FIREBASE_AUTH_EMULATOR_URL', 'http://127.0.0.1:9099');
    vi.stubEnv('VITE_FIREBASE_FIRESTORE_EMULATOR_URL', 'http://127.0.0.1:8080');

    await import('./firebase');

    expect(initializeApp).toHaveBeenCalledExactlyOnceWith({
      apiKey: productionConfig.VITE_FIREBASE_API_KEY,
      authDomain: productionConfig.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: productionConfig.VITE_FIREBASE_PROJECT_ID,
      appId: productionConfig.VITE_FIREBASE_APP_ID,
    });
    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });
});
