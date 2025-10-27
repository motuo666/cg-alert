/**
 * diff_engine.js
 * Minimal placeholder diff generator.
 * real diffing can be improved; we just expose simpleDiff(a,b)
 */
function simpleDiff(oldText, newText){
  if (oldText === newText) return "no-change";
  return "changed";
}
module.exports = { simpleDiff };
