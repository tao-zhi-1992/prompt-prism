# Changelog

## [0.4.3](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.4.2...v0.4.3) (2026-08-15)

### Bug Fixes

* **trace:** infer parents within explicit runs

### Refactoring

* **dashboard:** move structured content to dashboard kit
* **plugins:** remove unused registry

### Documentation

* align development demo with dynamic proxy
* remove internal dynamic mode wording
* simplify upstream guide

### Tests

* colocate single-module tests
* expand StructuredContent coverage

## [0.4.2](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.4.1...v0.4.2) (2026-08-14)

### Bug Fixes

* **release:** prevent workspace dependencies from leaking into npm metadata

## [0.4.1](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.4.0...v0.4.1) (2026-08-14)

### Bug Fixes

* **release:** make npm tarballs installable when publishing from the workspace

## [0.4.0](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.3.2...v0.4.0) (2026-08-14)

### Features

* **cli:** add registry fallback update checks ([9cc4a78](https://github.com/tao-zhi-1992/prompt-prism/commit/9cc4a784f66c13d13146eb90b3978cca2c6950ea))
* **dashboard:** add trace request indexes and navigation ([9690a65](https://github.com/tao-zhi-1992/prompt-prism/commit/9690a65e9f788bcdc8ae9636daeb07c9b8fb00fc))
* **dashboard:** link logo to landing page ([8176159](https://github.com/tao-zhi-1992/prompt-prism/commit/8176159867b1ca0b7ada92f103318c72f885115f))
* **protocol:** add official adapter fixtures ([3012144](https://github.com/tao-zhi-1992/prompt-prism/commit/301214401fc82eff7f2bda84aeef27cb57098a7e))
* **trace:** add memorable display aliases ([004519c](https://github.com/tao-zhi-1992/prompt-prism/commit/004519c1c4112a05367546f127e68ceec140dcc5))

### Bug Fixes

* **release:** use public entrypoint for dashboard screenshot ([bc10262](https://github.com/tao-zhi-1992/prompt-prism/commit/bc10262b93dbd4b31ae7c994bbff68a79dd4e015))

### Refactoring

* **core:** move unit tests into core package ([e8ce976](https://github.com/tao-zhi-1992/prompt-prism/commit/e8ce976cda4a2b75724303f66e23926ca18c376d))
* **packages:** split core modules into workspace packages ([8f647d8](https://github.com/tao-zhi-1992/prompt-prism/commit/8f647d8e38a5a4fbf2b45b4ccb5ed3f7dbcae5f6))
* **trace:** decouple trace lifecycle from input diff ([dc3ca00](https://github.com/tao-zhi-1992/prompt-prism/commit/dc3ca006a1e33fa65260d0c952eae919f8e04cc3))

### Documentation

* clarify local capture storage ([adb1add](https://github.com/tao-zhi-1992/prompt-prism/commit/adb1add0584a140c63d3c6a672825920094e9cfb))

### Tests

* **core:** enforce coverage gates ([09a33cd](https://github.com/tao-zhi-1992/prompt-prism/commit/09a33cd749681bbff9b17fdc30519c18c752806d))
* align package test ownership ([c849d34](https://github.com/tao-zhi-1992/prompt-prism/commit/c849d340e2753ff558ad4b748156d43e85afc24a))

### Styles

* **dashboard:** refine selected request state ([8d581fc](https://github.com/tao-zhi-1992/prompt-prism/commit/8d581fc06c9723157a612dc89759efa5732eef22))
* **dashboard:** simplify trace styling ([042e4ec](https://github.com/tao-zhi-1992/prompt-prism/commit/042e4ec0e0896ad48976115bf4f32b78057bbc2d))
* **dashboard:** unify system prompt labels ([32061b7](https://github.com/tao-zhi-1992/prompt-prism/commit/32061b76fd604d095388c885bd3eb9a265fdd681))
* standardize test layout ([c35fb2a](https://github.com/tao-zhi-1992/prompt-prism/commit/c35fb2a462f2f59cad86c690cb055b82400f891c))

## [0.3.2](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.3.1...v0.3.2) (2026-08-13)


### Bug Fixes

* **ci:** repair release tag workflow ([e168b90](https://github.com/tao-zhi-1992/prompt-prism/commit/e168b9067bbca4d5daa1e144c6526906722d35c7))
* **dashboard:** unify structural border colors ([49a718e](https://github.com/tao-zhi-1992/prompt-prism/commit/49a718e2201e5a109bf56bc01ce70ffb4e36f5c3))


### Documentation

* simplify Agent flow diagrams ([5ad973a](https://github.com/tao-zhi-1992/prompt-prism/commit/5ad973af395684856851cc5bf0dc6f0e3467e24f))

## [0.3.1](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.3.0...v0.3.1) (2026-08-13)


### Features

* **ci:** add release preparation workflow ([a4baa16](https://github.com/tao-zhi-1992/prompt-prism/commit/a4baa16b8bd24ab802a74b29b18385da2c2b905e))


### Bug Fixes

* **core:** harden capture persistence lifecycle ([c28c619](https://github.com/tao-zhi-1992/prompt-prism/commit/c28c619688b4ec5179390a9ff8755224e8c6caa9))


### Documentation

* simplify Agent proxy flow ([d4af336](https://github.com/tao-zhi-1992/prompt-prism/commit/d4af3362bc809d283bf2124df246d06f7dc75c0e))

## [0.3.0](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.2.0...v0.3.0) (2026-08-12)


### Features

* **cli:** add version command ([0579b76](https://github.com/tao-zhi-1992/prompt-prism/commit/0579b76744468f272978100d57a5702d03887def))
* **proxy:** simplify dynamic proxy URLs ([10ce783](https://github.com/tao-zhi-1992/prompt-prism/commit/10ce783b069a9cd39516357c4c70ff902e3f746a))


### Bug Fixes

* **release:** restore published version baseline ([ecf2804](https://github.com/tao-zhi-1992/prompt-prism/commit/ecf28043ba49503ba2f790bd0f174618bac24ec2))

## [0.2.0](https://github.com/tao-zhi-1992/prompt-prism/compare/v0.1.2...v0.2.0) (2026-08-12)


### Features

* **proxy:** add dynamic upstream URLs ([8847ba8](https://github.com/tao-zhi-1992/prompt-prism/commit/8847ba84bf1a1eaa72b552de9b1beca67038659e))
* **proxy:** require explicit upstream configuration ([17dc37d](https://github.com/tao-zhi-1992/prompt-prism/commit/17dc37d8fe4657eb09e2af61b43b16d66974efa4))


### Bug Fixes

* **proxy:** support complete dynamic upstream URLs ([ecda87e](https://github.com/tao-zhi-1992/prompt-prism/commit/ecda87ebbaee6b74b0c26e14ec1dd32e4b038c47))

## Changelog

All notable changes to Prompt Prism are documented in this file. Release entries are maintained manually.
