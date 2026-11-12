# Changelog

## [1.14.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.6...v1.14.0) (2026-11-12)


### Features

* **mcp:** add latest has smr and asmr opinions to get_medicine_info ([#103](https://github.com/amine7536/mcp-medicaments-france/issues/103)) ([d3816ed](https://github.com/amine7536/mcp-medicaments-france/commit/d3816ed05b5bba8ad9750c32e70494e60398cb3c))


### Bug Fixes

* **bdpm:** serve therapeutic fraction dosages and the authorisation status ([#101](https://github.com/amine7536/mcp-medicaments-france/issues/101)) ([49d2c19](https://github.com/amine7536/mcp-medicaments-france/commit/49d2c190efd21e98868edb2c661458c3b770e110))

## [1.13.6](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.5...v1.13.6) (2026-11-10)


### Bug Fixes

* **ingest:** delete return changes recorded by parser upgrades ([#99](https://github.com/amine7536/mcp-medicaments-france/issues/99)) ([68e591b](https://github.com/amine7536/mcp-medicaments-france/commit/68e591b46310db69795125b3f88e877452d5fb57))

## [1.13.5](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.4...v1.13.5) (2026-11-10)


### Bug Fixes

* **ingest:** extract scope and expected return with workers ai ([#97](https://github.com/amine7536/mcp-medicaments-france/issues/97)) ([76c8994](https://github.com/amine7536/mcp-medicaments-france/commit/76c8994358d4af4827ea874d2c084c2b88708555))

## [1.13.4](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.3...v1.13.4) (2026-11-10)


### Bug Fixes

* **ingest:** read free-text scope and return observation lines ([#95](https://github.com/amine7536/mcp-medicaments-france/issues/95)) ([8d2a95b](https://github.com/amine7536/mcp-medicaments-france/commit/8d2a95b2e63875ece620e3f5c40696940af6a0b9))
* **ingest:** stop recording reworded or dropped expected returns as changes ([#93](https://github.com/amine7536/mcp-medicaments-france/issues/93)) ([3163d0f](https://github.com/amine7536/mcp-medicaments-france/commit/3163d0ffe44d26f8b7172bf122873e0924456fbc))
* **mcp:** add in_shortage_total to name-resolved candidates ([#96](https://github.com/amine7536/mcp-medicaments-france/issues/96)) ([c433f61](https://github.com/amine7536/mcp-medicaments-france/commit/c433f611665ae5add7df2856d62a666aa669d35c))

## [1.13.3](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.2...v1.13.3) (2026-11-09)


### Bug Fixes

* **mcp:** add the mitm mix of all matches to the candidates data ([#82](https://github.com/amine7536/mcp-medicaments-france/issues/82)) ([4a5845b](https://github.com/amine7536/mcp-medicaments-france/commit/4a5845b406612f621c2eb141faf7937412158052))
* **mcp:** flag late début and mi returns and parse quarter parts and seasons ([#85](https://github.com/amine7536/mcp-medicaments-france/issues/85)) ([82e8a2d](https://github.com/amine7536/mcp-medicaments-france/commit/82e8a2d92f0e9ea07bbaa09befd1fb2166f6143e))
* **mcp:** flag the asked brand and dose and stop aggregating across doses ([#84](https://github.com/amine7536/mcp-medicaments-france/issues/84)) ([cff1a35](https://github.com/amine7536/mcp-medicaments-france/commit/cff1a35ddedca7839f7c313e3ccfe3125973007c))
* **mcp:** show holder and marketing status on same-name search rows ([#86](https://github.com/amine7536/mcp-medicaments-france/issues/86)) ([c12f615](https://github.com/amine7536/mcp-medicaments-france/commit/c12f615180782fb91575d5ca8738523db2a8b012))
* **mcp:** state the match total in search results and the import start in health ([#87](https://github.com/amine7536/mcp-medicaments-france/issues/87)) ([8339ae8](https://github.com/amine7536/mcp-medicaments-france/commit/8339ae8479371e8042aa4cafdbf0203ae3217835))

## [1.13.2](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.1...v1.13.2) (2026-11-07)


### Bug Fixes

* **mcp:** allow extra properties in the served output schemas ([#80](https://github.com/amine7536/mcp-medicaments-france/issues/80)) ([eee07f7](https://github.com/amine7536/mcp-medicaments-france/commit/eee07f73dfb78d27128d5f6c735dd004c40bb377))

## [1.13.1](https://github.com/amine7536/mcp-medicaments-france/compare/v1.13.0...v1.13.1) (2026-11-06)


### Bug Fixes

* **mcp:** restore the published output schema for candidates ([#78](https://github.com/amine7536/mcp-medicaments-france/issues/78)) ([dc42f20](https://github.com/amine7536/mcp-medicaments-france/commit/dc42f2079846cf88033fca0e924232c04c1e65f0))

## [1.13.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.12.0...v1.13.0) (2026-11-05)


### Features

* **mcp:** report the mitm mix of all matches in is_major_therapeutic_interest candidates ([#76](https://github.com/amine7536/mcp-medicaments-france/issues/76)) ([8e25221](https://github.com/amine7536/mcp-medicaments-france/commit/8e25221c71f1fe7808e7c9e0b04d61142adeb333))


### Bug Fixes

* **mcp:** list medicines in rupture or tension first in candidates ([#74](https://github.com/amine7536/mcp-medicaments-france/issues/74)) ([0123d60](https://github.com/amine7536/mcp-medicaments-france/commit/0123d6041d9834f84a78ea58f49cb660c1e59b04))

## [1.12.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.11.0...v1.12.0) (2026-11-04)


### Features

* **mcp:** answer once for mitm lookups by name and add mitm status to candidates ([#68](https://github.com/amine7536/mcp-medicaments-france/issues/68)) ([d016b6c](https://github.com/amine7536/mcp-medicaments-france/commit/d016b6c72ffca89f574fd22825b2a545871976e5))

## [1.11.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.10.3...v1.11.0) (2026-11-03)


### Features

* **mcp:** rank name matches, suggest spellings and aggregate candidates by shortage entry ([#65](https://github.com/amine7536/mcp-medicaments-france/issues/65)) ([5259567](https://github.com/amine7536/mcp-medicaments-france/commit/5259567253f30068d9b267f0fcb09f7654b65875))

## [1.10.3](https://github.com/amine7536/mcp-medicaments-france/compare/v1.10.2...v1.10.3) (2026-11-03)


### Bug Fixes

* **mcp:** report the ansm shortage status and marketing-stop conflict in medicine info ([#63](https://github.com/amine7536/mcp-medicaments-france/issues/63)) ([502d7a0](https://github.com/amine7536/mcp-medicaments-france/commit/502d7a05784bbc336ca35d8cd4a402ec9d5c368b))
* **mcp:** stop picking one linked medicine for a shortage id lookup ([#64](https://github.com/amine7536/mcp-medicaments-france/issues/64)) ([47c351d](https://github.com/amine7536/mcp-medicaments-france/commit/47c351d0cc5078d7fd23bf3538a9c6a99c066b96))
* **mcp:** validate shortage ids and barcodes, list known areas and cap linked medicines ([#61](https://github.com/amine7536/mcp-medicaments-france/issues/61)) ([a719520](https://github.com/amine7536/mcp-medicaments-france/commit/a7195202add5a487e9e7a50092962336a44646b7))

## [1.10.2](https://github.com/amine7536/mcp-medicaments-france/compare/v1.10.1...v1.10.2) (2026-11-02)


### Bug Fixes

* **mcp:** correct change history and recent_changes reporting ([#59](https://github.com/amine7536/mcp-medicaments-france/issues/59)) ([65fe4d2](https://github.com/amine7536/mcp-medicaments-france/commit/65fe4d234162f9fe674e9e6d8fdf2d57674ea1b0))

## [1.10.1](https://github.com/amine7536/mcp-medicaments-france/compare/v1.10.0...v1.10.1) (2026-11-02)


### Bug Fixes

* **match:** link dose-list entries and same-product doses ([#57](https://github.com/amine7536/mcp-medicaments-france/issues/57)) ([c562aca](https://github.com/amine7536/mcp-medicaments-france/commit/c562aca9555aab429dfd8cbe4bc3591472939ccd))

## [1.10.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.9.0...v1.10.0) (2026-11-02)


### Features

* **mcp:** add title, description and website url to server info ([#54](https://github.com/amine7536/mcp-medicaments-france/issues/54)) ([1f900aa](https://github.com/amine7536/mcp-medicaments-france/commit/1f900aaaa680bed34d32f7d06b40e8e203f2726a))

## [1.9.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.8.1...v1.9.0) (2026-10-30)


### Features

* **landing:** link the claude directory listing ([#52](https://github.com/amine7536/mcp-medicaments-france/issues/52)) ([7572e4d](https://github.com/amine7536/mcp-medicaments-france/commit/7572e4df0cbbe74f25d874b9018e6fe144ed147c))

## [1.8.1](https://github.com/amine7536/mcp-medicaments-france/compare/v1.8.0...v1.8.1) (2026-10-30)


### Bug Fixes

* **mcp:** describe shortage_id by its value ([#50](https://github.com/amine7536/mcp-medicaments-france/issues/50)) ([ade9408](https://github.com/amine7536/mcp-medicaments-france/commit/ade94086442205df8b440729d17fea9220862615))
* **mcp:** describe tools without instructing the model ([#46](https://github.com/amine7536/mcp-medicaments-france/issues/46)) ([3879a87](https://github.com/amine7536/mcp-medicaments-france/commit/3879a871d215b25172a4ab7b4890c8273a62f766))


### Reverts

* describe tools without instructing the model ([#48](https://github.com/amine7536/mcp-medicaments-france/issues/48)) ([a9d4dd1](https://github.com/amine7536/mcp-medicaments-france/commit/a9d4dd107f69199591b5c2598621f7f5cb30eecc))

## [1.8.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.7.0...v1.8.0) (2026-10-29)


### Features

* **scripts:** show why golden answers fail and isolate them from user settings ([#41](https://github.com/amine7536/mcp-medicaments-france/issues/41)) ([f6cb149](https://github.com/amine7536/mcp-medicaments-france/commit/f6cb149791fa74b397e50bcbe030a6a06cb49edb))


### Bug Fixes

* **mcp:** describe tools without instructing the model ([#38](https://github.com/amine7536/mcp-medicaments-france/issues/38)) ([7b847bd](https://github.com/amine7536/mcp-medicaments-france/commit/7b847bd7a37fd83b8004ce62d3332ca83439c573))


### Reverts

* describe tools without instructing the model ([#40](https://github.com/amine7536/mcp-medicaments-france/issues/40)) ([c12ae7b](https://github.com/amine7536/mcp-medicaments-france/commit/c12ae7bb419246b5c0d524388f6dd63ec1cc8bb4))

## [1.7.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.6.0...v1.7.0) (2026-10-29)


### Features

* **scripts:** add a tool-call usage report ([#25](https://github.com/amine7536/mcp-medicaments-france/issues/25)) ([abc8c47](https://github.com/amine7536/mcp-medicaments-france/commit/abc8c479f5019d0a6ef3862c6930a52efa5b2b7a))


### Bug Fixes

* **landing:** describe the service by its medicines data first ([#27](https://github.com/amine7536/mcp-medicaments-france/issues/27)) ([c5c7407](https://github.com/amine7536/mcp-medicaments-france/commit/c5c740737dbbd3cc8bfb2786c3db165e967f506d))

## [1.6.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.5.0...v1.6.0) (2026-10-29)


### Features

* **landing:** add the privacy page and site icon ([#23](https://github.com/amine7536/mcp-medicaments-france/issues/23)) ([e2617ba](https://github.com/amine7536/mcp-medicaments-france/commit/e2617ba25a620ba16012baa10ef5241a4615f389))

## [1.5.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.4.0...v1.5.0) (2026-10-28)


### Features

* **mcp:** cite the bdpm import date and describe the medicines reference data ([#20](https://github.com/amine7536/mcp-medicaments-france/issues/20)) ([610b554](https://github.com/amine7536/mcp-medicaments-france/commit/610b55413042813f6853cd3b747e666ebbb04520))

## [1.4.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.3.0...v1.4.0) (2026-10-28)


### Features

* **mcp:** add current ansm safety information to get_medicine_info ([#19](https://github.com/amine7536/mcp-medicaments-france/issues/19)) ([fc6cfa8](https://github.com/amine7536/mcp-medicaments-france/commit/fc6cfa8d53edd7a4102b3318e0783cfed38c39e5))
* **mcp:** add prescription and dispensing conditions to get_medicine_info ([#17](https://github.com/amine7536/mcp-medicaments-france/issues/17)) ([05ee4ea](https://github.com/amine7536/mcp-medicaments-france/commit/05ee4eab03492849f7076ed6185d17e761caac76))

## [1.3.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.2.0...v1.3.0) (2026-10-28)


### Features

* **mcp:** add get_medicine_info with medicine presentations ([#15](https://github.com/amine7536/mcp-medicaments-france/issues/15)) ([cdde0e1](https://github.com/amine7536/mcp-medicaments-france/commit/cdde0e1283bbc1a76883fbe853e8467d5e5212b7))

## [1.2.0](https://github.com/amine7536/mcp-medicaments-france/compare/v1.1.0...v1.2.0) (2026-10-28)


### Features

* **landing:** add medical disclaimer banner and example answers ([#9](https://github.com/amine7536/mcp-medicaments-france/issues/9)) ([cf3fc72](https://github.com/amine7536/mcp-medicaments-france/commit/cf3fc7282526642363ab45d4a3494e07110c09a9))
* **landing:** serve the page in french or english with a restrained design ([#10](https://github.com/amine7536/mcp-medicaments-france/issues/10)) ([8639100](https://github.com/amine7536/mcp-medicaments-france/commit/86391007040072b7bf84285ead2ce18cf4b5998c))
