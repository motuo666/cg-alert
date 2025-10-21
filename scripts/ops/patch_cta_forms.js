// scripts/ops/patch_cta_forms.js
// Usage: node scripts/ops/patch_cta_forms.js
// - Scans public/**/*.html
// - Adds data-lead-post="1" to forms that contain an email input
// - Injects <script src="/public/js/lead.js"></script> before </body> if missing
import fs from "fs";
import path from "path";

const ROOT = "public";
const JS_SNIPPET = '<script src="/public/js/lead.js"></script>';

function walk(dir){
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && f.toLowerCase().endsWith(".html")) out.push(p);
  }
  return out;
}

function hasLeadScript(html) {
  return html.includes("/public/js/lead.js");
}

function tagForms(html) {
  // naive but safe: add attribute to <form ...> that has email input in same file
  // We'll only add if the tag doesn't already contain data-lead-post
  return html.replace(/<form\b(?![^>]*\bdata-lead-post\b)([^>]*)>/gi, (m, attrs) => {
    // cheap heuristic: only tag if this file contains an email input somewhere
    if (!/input[^>]+type=["']?email/i.test(html)) return m;
    return `<form data-lead-post="1"${attrs}>`;
  });
}

function injectScript(html) {
  if (hasLeadScript(html)) return html;
  if (html.includes("</body>")) {
    return html.replace(/<\/body>/i, `${JS_SNIPPET}\n</body>`);
  }
  return html + "\n" + JS_SNIPPET + "\n";
}

function main(){
  const files = walk(ROOT);
  let changed = 0;
  for (const file of files) {
    let html = fs.readFileSync(file, "utf-8");
    const orig = html;
    html = tagForms(html);
    html = injectScript(html);
    if (html !== orig) {
      fs.writeFileSync(file, html);
      changed++;
      console.log("patched:", file);
    }
  }
  console.log("done, changed:", changed);
}

main();
