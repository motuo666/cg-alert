// CommonJS — three persona templates. Keep plain text for deliverability.
function baseFooter() {
  return [
    "",
    "— CG Alert",
    "Evidence‑backed vendor change monitoring",
    "Unsubscribe: ${UNSUB_ORIGIN}/u?e=${EMAIL}&h=${HMAC}"
  ].join("\n");
}

function tplOPS(ctx){
  const { company, vendorsStr } = ctx;
  return {
    subject: `[CG Alert] Cut noisy vendor pings; keep the ones that matter for ${company||'your team'}`,
    body: [
      `Hi ${ctx.name||''},`,
      `We track your named vendors’ Pricing / ToS / DPA / Subprocessors / Status pages.`,
      `Only material diffs become "evidence cards" (timestamp + SHA‑256). No screenshots, no noise.`,
      vendorsStr ? `Happy to start with: ${vendorsStr}.` : ``,
      `Reply with your top 3 vendors and we’ll set them up today.`,
      baseFooter()
    ].filter(Boolean).join("\n")
  };
}

function tplLEGAL(ctx){
  const { company, vendorsStr } = ctx;
  return {
    subject: `[CG Alert] Renewal leverage with timestamped evidence for ${company||'your team'}`,
    body: [
      `Hi ${ctx.name||''},`,
      `When vendors change liability, SLAs, or sub‑processors, we capture a signed trail (URL + time + hash).`,
      `Use it to demand credits, legacy terms, or better caps at renewal.`,
      vendorsStr ? `Recent movement on: ${vendorsStr}.` : ``,
      `Reply with 3 vendors and we’ll enable email/Slack delivery.`,
      baseFooter()
    ].filter(Boolean).join("\n")
  };
}

function tplREVOPS(ctx){
  const { company, vendorsStr } = ctx;
  return {
    subject: `[CG Alert] Reduce surprise price uplifts — evidence for ${company||'your team'}`,
    body: [
      `Hi ${ctx.name||''},`,
      `We monitor public pricing & ToS for your stack and alert only when it affects spend or terms.`,
      `Each alert links to an evidence card you can forward to the vendor.`,
      vendorsStr ? `Common targets: ${vendorsStr}.` : ``,
      `Reply with your top 3 vendors; we’ll switch it on.`,
      baseFooter()
    ].filter(Boolean).join("\n")
  };
}

module.exports = { tplOPS, tplLEGAL, tplREVOPS };
