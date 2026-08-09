import '@testing-library/jest-dom/vitest';

if (!window.PointerEvent) {
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });
}

if (!window.ResizeObserver) {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
