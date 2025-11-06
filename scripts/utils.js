// CommonJS helpers
const fs = require('node:fs/promises');
const path = require('node:path');

function slugify(v){ return (v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'unknown'; }

async function readJSON(p, def=null){ try{ return JSON.parse(await fs.readFile(p,'utf8')); }catch{ return def; } }
async function writeJSON(p, obj){ await fs.mkdir(path.dirname(p),{recursive:true}); await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8'); }

function nowISO(){ return new Date().toISOString(); }

module.exports = { fs, path, slugify, readJSON, writeJSON, nowISO };
