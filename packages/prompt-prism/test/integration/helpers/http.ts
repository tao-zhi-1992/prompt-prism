import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const listen = (server: http.Server): Promise<number> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
});

export const close = (server: http.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

export interface HttpResult {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
  times: number[];
}

export function request({
  port,
  pathname = '/v1/messages',
  headers = {},
  body,
}: {
  port: number;
  pathname?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string;
}): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const times: number[] = [];
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method: body ? 'POST' : 'GET', headers }, (response) => {
      response.on('data', (chunk) => { chunks.push(chunk); times.push(Date.now() - started); });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString(), times }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
