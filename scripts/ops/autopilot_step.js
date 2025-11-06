
#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const r = spawnSync('node', ['scripts/ops/autopilot_step.mjs'], { stdio: 'inherit' });
process.exit(r.status || 0);
