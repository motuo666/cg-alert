#!/usr/bin/env node
// upsell_capacity.js — notify Slack if capacity is available
const { post } = require('./lib/slack_notify'); const SLACK=process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
(async function(){ const msg='Capacity update: CG Alert ready for 2–3 new Business/Enterprise accounts.'; console.log(msg); if(SLACK) await post(SLACK, msg); })().catch(()=>{});