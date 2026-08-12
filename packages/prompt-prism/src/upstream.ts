import { TextDecoder } from 'node:util';
import { detectProtocolFromPath } from './adapter/detection.js';

export const DYNAMIC_UPSTREAM_PREFIX = '/_pp/up/';
const MAX_UPSTREAM_BYTES = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function parseUpstreamUrl(value: string | URL): URL {
  let upstreamUrl;
  try { upstreamUrl = new URL(value); }
  catch { throw new Error('Upstream URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) throw new Error('Upstream URL must use http or https');
  if (upstreamUrl.hash) throw new Error('Upstream URL must not contain a fragment');
  return upstreamUrl;
}

export function parseUpstreamBaseUrl(value: string | URL): URL {
  const upstreamUrl = parseUpstreamUrl(value);
  if (upstreamUrl.username || upstreamUrl.password) throw new Error('Upstream Base URL must not contain credentials');
  if (upstreamUrl.search) throw new Error('Upstream Base URL must not contain a query; use --upstream-url for an exact endpoint');
  if (detectProtocolFromPath(upstreamUrl.pathname)) throw new Error('Upstream Base URL must not include an API endpoint; use --upstream-url for a complete endpoint');
  upstreamUrl.pathname = upstreamUrl.pathname.replace(/\/+$/, '');
  if (Buffer.byteLength(upstreamUrl.href) > MAX_UPSTREAM_BYTES) throw new Error(`Upstream Base URL must not exceed ${MAX_UPSTREAM_BYTES} bytes`);
  return upstreamUrl;
}

function parseDynamicUpstreamUrl(value: string | URL): URL {
  const upstreamUrl = parseUpstreamUrl(value);
  if (upstreamUrl.username || upstreamUrl.password) throw new Error('Upstream URL must not contain credentials');
  if (upstreamUrl.search) throw new Error('Upstream URL must not contain a query');
  if (Buffer.byteLength(upstreamUrl.href) > MAX_UPSTREAM_BYTES) throw new Error(`Upstream URL must not exceed ${MAX_UPSTREAM_BYTES} bytes`);
  return upstreamUrl;
}

export function encodeUpstreamBaseUrl(value: string | URL): string {
  return Buffer.from(parseUpstreamBaseUrl(value).href, 'utf8').toString('base64url');
}

export function decodeUpstreamBaseUrl(token: string): URL {
  if (!token || !BASE64URL.test(token) || token.length > Math.ceil(MAX_UPSTREAM_BYTES * 4 / 3)) throw new Error('Invalid dynamic upstream token');
  let bytes: Buffer;
  let decoded: string;
  try {
    bytes = Buffer.from(token, 'base64url');
    if (bytes.length > MAX_UPSTREAM_BYTES || bytes.toString('base64url') !== token) throw new Error();
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { throw new Error('Invalid dynamic upstream token'); }
  const upstream = parseUpstreamBaseUrl(decoded);
  if (encodeUpstreamBaseUrl(upstream) !== token) throw new Error('Invalid dynamic upstream token');
  return upstream;
}

function encodeDynamicUpstreamUrl(value: string | URL): string {
  return Buffer.from(parseDynamicUpstreamUrl(value).href, 'utf8').toString('base64url');
}

function decodeDynamicUpstreamUrl(token: string): URL {
  if (!token || !BASE64URL.test(token) || token.length > Math.ceil(MAX_UPSTREAM_BYTES * 4 / 3)) throw new Error('Invalid dynamic upstream token');
  let bytes: Buffer;
  let decoded: string;
  try {
    bytes = Buffer.from(token, 'base64url');
    if (bytes.length > MAX_UPSTREAM_BYTES || bytes.toString('base64url') !== token) throw new Error();
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { throw new Error('Invalid dynamic upstream token'); }
  const upstream = parseDynamicUpstreamUrl(decoded);
  if (encodeDynamicUpstreamUrl(upstream) !== token) throw new Error('Invalid dynamic upstream token');
  return upstream;
}

function parseProxyBaseUrl(value: string | URL): URL {
  let proxyUrl;
  try { proxyUrl = new URL(value); }
  catch { throw new Error('Proxy URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(proxyUrl.protocol)) throw new Error('Proxy URL must use http or https');
  if (proxyUrl.username || proxyUrl.password || proxyUrl.search || proxyUrl.hash || !/^\/*$/.test(proxyUrl.pathname)) {
    throw new Error('Proxy URL must be an origin without credentials, path, query, or fragment');
  }
  proxyUrl.pathname = '';
  return proxyUrl;
}

export function buildDynamicProxyBaseUrl(upstreamBaseUrl: string | URL, proxyBaseUrl: string | URL = 'http://127.0.0.1:1028'): string {
  const proxyUrl = parseProxyBaseUrl(proxyBaseUrl);
  proxyUrl.pathname = `${DYNAMIC_UPSTREAM_PREFIX}${encodeDynamicUpstreamUrl(upstreamBaseUrl)}`;
  return proxyUrl.href;
}

export interface DynamicUpstreamRoute {
  baseUrl: URL;
  requestUrl: string;
  requestPath: string;
  requestSuffix: string | null;
}

export function parseDynamicUpstreamRoute(requestUrl: string | undefined): DynamicUpstreamRoute | null {
  const incoming = new URL(requestUrl ?? '/', 'http://prompt-prism.local');
  if (!incoming.pathname.startsWith(DYNAMIC_UPSTREAM_PREFIX)) return null;
  const encodedAndSuffix = incoming.pathname.slice(DYNAMIC_UPSTREAM_PREFIX.length);
  const separator = encodedAndSuffix.indexOf('/');
  const token = separator === -1 ? encodedAndSuffix : encodedAndSuffix.slice(0, separator);
  const requestSuffix = separator === -1 ? null : encodedAndSuffix.slice(separator);
  const requestPath = requestSuffix ?? '/';
  return {
    baseUrl: decodeDynamicUpstreamUrl(token),
    requestUrl: `${requestPath}${incoming.search}`,
    requestPath,
    requestSuffix,
  };
}
