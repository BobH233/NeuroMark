/// <reference types="vite/client" />

import type { NeuromarkApi } from '@preload/contracts';

declare global {
  interface Window {
    neuromark: NeuromarkApi;
  }
}

export {};
