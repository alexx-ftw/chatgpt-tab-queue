# v0.6.0 native distribution and integration

Goal: signed CRX3 releases on GitHub using the browser updater; no local updater,
native host, scheduled OS job, remote JavaScript, tab activation or chat navigation.

Implementation:
1. Regression tests for immediate/deadlined injection and idle update boundaries.
2. Native update lifecycle, existing-page reattachment and capture-aware quiescence.
3. Reconnect recovery and stable minimal UI; retain conservative uncertain-send logic.
4. Portable browser-only queue export/import for the one-time unpacked-to-signed move.
5. Reproducible allowlisted CRX3 packaging, private signing key and GitHub release workflow.
6. Tests, clean-room browser checks where allowed, signed-artifact verification and publish.

Verification separates simulated API tests, real browser rendering, signature/host checks,
and live ChatGPT behavior. No inferred success from one of these to another.
