#!/usr/bin/env node
// send_monthly_digest.js — builds CSV digest summary & Slack note
const fs=require('fs'), path=require('path'); const { post } = require('./lib/slack_notify');
const SLACK=process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
(function main(){
  const now = new Date(); const ym = now.toISOString().slice(0,7);
  const sent = fs.existsSync('data/sent_log.csv')?fs.readFileSync('data/sent_log.csv','utf8').split(/\r?\n/).filter(Boolean).length:0;
  const msg = `Monthly Digest for ${ym}: sent_log=${sent}`; console.log(msg); if(SLACK) post(SLACK, msg);
})();