#!/usr/bin/env node
// leads_sanity.js — proxy to validate_leads.js
require('child_process').execSync('node scripts/validate_leads.js', { stdio: 'inherit' });
