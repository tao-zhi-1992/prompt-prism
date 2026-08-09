import type { ProviderRequest, ProviderResponse } from '../types.js';

export interface ProviderAdapter {
  readonly id: string;
  parseRequest(body: Buffer | string): ProviderRequest;
  parseResponse(body: Buffer | string, contentType?: string): ProviderResponse;
}
