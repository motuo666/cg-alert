#!/usr/bin/env node
// collect_evidence.js — placeholder: ensures evidence dir exists; NO network crawling here
const fs=require('fs'), path=require('path');
(function main(){ fs.mkdirSync('evidence',{recursive:true}); console.log('[collect] evidence directory ensured'); })();