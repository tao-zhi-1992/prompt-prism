# Changelog

All notable changes to Prompt Prism are documented in this file.

## [Unreleased]

### Added

- Dynamic upstream proxy URLs using the `/_pp/up/<token>` route.
- `p2 url` for generating a copyable SDK Base URL for any provider Base URL.
- A Dashboard Proxy URL generator, available from the right side of the detail tab bar before and after captures exist.
- Programmatic `buildDynamicProxyBaseUrl` and `encodeUpstreamBaseUrl` helpers.
- Integration coverage for the official OpenAI and Anthropic JavaScript SDKs using dynamic upstream URLs.

### Changed

- Auto protocol detection now uses the current dynamic upstream as its per-request fallback hint.
- Dynamic upstream routing is disabled by default for non-loopback listeners; embedded servers can opt in with `allowRemoteDynamicUpstream`.
