# V60.12.2 historical packaging evidence
These files describe checks actually run during packaging on Linux / Node 22.16.0.
`*-final.log` are executed local controlled tests, not full Next/browser proof.
`browser-inventory.json` is test registration only.
`browser-helper-markup.json` is Chromium set_content markup/selector smoke only.
`helper-types.log` is isolated library API assignability, not application tsc.
`release-gate-attempt.json` is FAILED at npm registry installation; later stages
are not_run. No successful complete release/build/audit is claimed here.
The next local `npm run verify:release` writes a fresh qa/release-checks.json.
