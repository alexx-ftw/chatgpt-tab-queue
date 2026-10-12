# v0.6.0 verification

* 155 Node tests passed, 0 failed and 0 skipped.
* Manifest resources, JavaScript syntax, permissions, CSP and clear-all checks passed.
* 19 checks passed in an isolated Chromium DOM fixture, including a version
  reattachment with no reload/draft change and no duplicate Tab listeners.
* The fixture uses mocked extension RPC and a mocked ChatGPT location. It is not
  a live ChatGPT session and not a complete extension-installation test.
* Packaging tests use a throwaway key: stable identity across versions, signature
  verification, tamper rejection and exclusion of private files.
* Real release signatures and public update URLs are checked when publishing.
* The test environment blocks extension installation and website navigation via
  administrative policy. Those policies were not modified or bypassed. Therefore
  browser-native update installation and live cross-chat background sending are
  not certified by these tests.

The source contains synthetic conversation IDs and short DOM fixtures, not
conversation exports, actual queued data, keys or browser profile files.
