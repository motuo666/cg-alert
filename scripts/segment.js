// scripts/segment.js
const ROLE_KEYWORDS = [
  { key: 'security', persona: 'Security' },
  { key: 'trust', persona: 'Security' },
  { key: 'compliance', persona: 'Legal' },
  { key: 'privacy', persona: 'Legal' },
  { key: 'legal', persona: 'Legal' },
  { key: 'procure', persona: 'Procurement' },
  { key: 'sourcing', persona: 'Procurement' },
  { key: 'revops', persona: 'RevOps' },
  { key: 'it', persona: 'IT' },
];
function personaFromRow(row) {
  const email = (row.email || '').toLowerCase();
  const notes = (row.notes || '').toLowerCase();
  const hay = `${email} ${notes}`;
  for (const r of ROLE_KEYWORDS) if (hay.includes(r.key)) return r.persona;
  return row.persona || 'General';
}
function subjectFor(persona, company) {
  switch (persona) {
    case 'Security': return `Subprocessor/pricing change alerts for ${company}`;
    case 'Legal': return `ToS/DPA change alerts you can verify (${company})`;
    case 'Procurement': return `Use vendor price/terms changes at renewal (${company})`;
    case 'RevOps': return `Prevent surprises from vendor changes (${company})`;
    default: return `Vendor-change alerts for ${company}`;
  }
}
module.exports = { personaFromRow, subjectFor };
