# Changelog
All notable changes to this project will be documented in this file.

## [0.0.2] - 2019-11-26
- sendRequest and its wrapper methods now return just the response body for more convenient calls
- onReverseRequest and its wrappers correctly expect the handler to just return the response body, instead of the entire response