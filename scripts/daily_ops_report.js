#!/usr/bin/env node
// daily_ops_report.js — summarize ops and send to Slack
const fs=require('fs'), path=require('path'); const { post } = require('./lib/slack_notify');
const SLACK=process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
function countLines(p){ return fs.existsSync(p) ? fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).length : 0; }
(function main(){
  const sent = countLines('data/sent_log.csv'); const leads = countLines('data/leads.csv'); const customers = countLines('data/customers.csv');
  const msg = `Daily Ops: leads=${leads}, customers=${customers}, sent_log=${sent}`;
  console.log(msg); if(SLACK) post(SLACK, msg);
})();