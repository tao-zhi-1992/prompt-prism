import type { ProviderRequest, ProviderResponse } from '../types.js';
import type http from 'node:http';

export interface ProviderAdapterDetection {
  detectPath(pathname: string): boolean;
  detectHeaders(headers: http.IncomingHttpHeaders): boolean;
  detectRequest(body: Buffer | string): boolean;
  detectResponse(body: Buffer | string): boolean;
  detectBaseUrl(url: URL): boolean;
  endpointPath: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly detection: ProviderAdapterDetection;
  parseRequest(body: Buffer | string): ProviderRequest;
  parseResponse(body: Buffer | string, contentType?: string): ProviderResponse;
}
