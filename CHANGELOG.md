# Changelog
All notable changes to this project will be documented in this file.

## [0.5.1] - 2021-06-03
- Fix audit vulnerability https://github.com/advisories/GHSA-f8q6-p94x-37v3

## [0.5.0] - 2021-06-03
- Remove gulp and bring dependencies up to date

## [0.4.0] - 2021-06-03
- Support vscode-debugprotocol v1.50.1

## [0.3.0] - 2021-06-03
- Support vscode-debugprotocol v1.48.0

## [0.2.0] - 2021-06-03
- Support vscode-debugprotocol v1.47.0
- switch to eslint
- upgrade various dependencies including typescript

## [0.1.1] - 2020-01-14
- Update docs

## [0.1.0] - 2020-01-14
- Publish to npm

## [0.0.2] - 2019-11-26
- sendRequest and its wrapper methods now return just the response body for more convenient calls
- onReverseRequest and its wrappers correctly expect the handler to just return the response body, instead of the entire response
