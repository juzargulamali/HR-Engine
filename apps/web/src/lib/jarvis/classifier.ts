/**
 * The hard exclusions, in code. Whatever else a person may do in the app, JARVIS has NO tool that reads or writes salaries, leave, payroll, other modules' records,
 * raw SQL, source code, credentials, application configuration, deployments, permission changes, or record and audit deletion. This classifier refuses such a
 * request BEFORE any provider call (so the text never leaves the app). It is defence in depth, not the wall: the wall is that no such action exists in the registry
 * and the database permissions apply whatever the text says. It looks for a request (a verb aimed at the sensitive thing), not the mere word, so a brief that
 * mentions "a payroll company's gala" passes. Deterministic, no model.
 */
export type ExclusionCategory = "payroll_salary" | "leave_hr" | "other_modules" | "raw_sql" | "source_code" | "credentials" | "app_config" | "deployment" | "permission_change" | "deletion" | "audit_deletion";

const VERBS_READ = "(?:show|list|tell|give|read|get|fetch|export|display|reveal|pull|open|see|view|print|send|share|dump|find|look\\s+up|check|what(?:'s| is| are)|how\\s+much)";
const GAP = "[^.\\n]{0,60}";

const RULES: { category: ExclusionCategory; re: RegExp }[] = [
  { category: "raw_sql", re: /\b(?:select\s+(?:\*|count\(|[\w.]+\s*,)[^;\n]{0,80}\bfrom\s+[\w."]+|select\s+[\w.]+\s+from\s+(?:crm_|profiles|auth|employees|user_roles|public\.)\w*|insert\s+into\s+\w+|update\s+\w+\s+set\s+\w+|delete\s+from\s+\w+|drop\s+(?:table|database|schema)|alter\s+table|truncate\s+table|run\s+(?:this\s+|a\s+|the\s+)?sql|sql\s+(?:query|statement|console)|psql\b)/i },
  { category: "audit_deletion", re: /\b(?:delete|remove|erase|purge|wipe|clear|truncate|tamper\s+with)\b[^.\n]{0,50}\b(?:audit|audit\s+log|logs?|history|timeline|ledger)\b/i },
  { category: "deletion", re: /\b(?:delete|erase|purge|wipe|destroy|truncate|drop)\b[^.\n]{0,50}\b(?:records?|enquir(?:y|ies)|opportunit(?:y|ies)|data|accounts?|users?|everything|all\s+of\s+it|the\s+database|tables?)\b/i },
  { category: "payroll_salary", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:payroll|salar(?:y|ies)|pay\\s?slips?|wages?|pay\\s+scale|bonus(?:es)?|compensation)\\b`, "i") },
  { category: "payroll_salary", re: /\b(?:payroll|salar(?:y|ies)|pay\s?slips?)\b[^.\n]{0,30}\b(?:of|for)\b[^.\n]{0,40}\b(?:employee|staff|everyone|all|him|her|them|\w+'s)\b/i },
  { category: "leave_hr", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:leave\\s+balances?|annual\\s+leave|sick\\s+leave|leave\\s+requests?|time\\s+off|attendance|clock(?:ed)?[-\\s]?in|recovery\\s+leave|hr\\s+(?:data|records?|files?)|personal\\s+data|performance\\s+reviews?|disciplinary)\\b`, "i") },
  { category: "other_modules", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:inventory|warehouse\\s+stock|stock\\s+levels?|project\\s+budgets?|budgets?\\s+and\\s+expenses?|expenses?|claims?|timesheets?|all\\s+employees|employee\\s+(?:list|records?|details)|staff\\s+list|projects?\\s+(?:list|tasks?|plans?))\\b`, "i") },
  { category: "source_code", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:source\\s+code|the\\s+code|code\\s+base|codebase|repo(?:sitory)?|git\\s+(?:log|diff|history)|pull\\s+request|api\\s+routes?|server\\s+actions?|migration\\s+files?|system\\s+prompt|your\\s+instructions|your\\s+prompt)\\b`, "i") },
  { category: "source_code", re: new RegExp(`\\b(?:${VERBS_READ}|repeat|recite|summari[sz]e|reveal|leak|ignore)\\b${GAP}\\b(?:system\\s+(?:prompt|message|instructions?)|hidden\\s+(?:prompt|instructions?)|your\\s+(?:tools?|tool\\s+list|functions?|instructions|prompt|rules)|the\\s+(?:tools|functions)\\s+you\\s+(?:have|can\\s+call)|internal\\s+(?:docs?|documents?|documentation|map|notes?)|action\\s+catalogue|app\\s+map)\\b`, "i") },
  { category: "other_modules", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:other|another|someone\\s+else's|everyone's|all)\\s+(?:users?|people|colleagues|staff|employees|salespeople)(?:'s|s')?\\s+(?:data|messages?|chats?|conversations?|enquir(?:y|ies)|records?|details|files?|requests?)\\b`, "i") },
  { category: "credentials", re: new RegExp(`\\b${VERBS_READ}\\b${GAP}\\b(?:api[\\s_-]?keys?|secrets?|passwords?|pass\\s?phrases?|tokens?|service[\\s_-]?role|credentials?|env(?:ironment)?\\s+variables?|\\.env|private\\s+keys?|connection\\s+strings?)\\b`, "i") },
  { category: "app_config", re: /\b(?:change|edit|update|modify|toggle|switch|set|disable|enable|turn\s+(?:on|off))\b[^.\n]{0,40}\b(?:app(?:lication)?\s+config(?:uration)?|environment\s+variables?|feature\s+flags?|the\s+pilot|pilot\s+(?:list|switch|users?)|kill\s+switch|jarvis\s+(?:settings?|switch|access)|writes?\s+switch|company\s+settings\s+for\s+the\s+app)\b/i },
  { category: "deployment", re: /\b(?:deploy|redeploy|roll\s?back|release|ship|push|promote|merge|publish)\b[^.\n]{0,40}\b(?:to\s+prod(?:uction)?|the\s+(?:app|site|website|build|code|branch|release)|production|vercel|main\s+branch|a\s+release)\b/i },
  { category: "permission_change", re: /\b(?:grant|give|make|promote|elevate|set|add|assign)\s+(?:me|myself|him|her|them|us|everyone|[\w.+-]+@[\w.-]+)\b[^.\n]{0,20}\b(?:an?\s+)?(?:admin(?:istrator)?|sys(?:tem)?\s?admin|founder|super\s?user|root|full\s+access|all\s+access|more\s+access|access\s+to\s+(?:everything|all|hr|payroll)|permissions?|privileges?)\b/i },
  { category: "permission_change", re: /\bgrant\s+(?:me|myself)\b/i },
  { category: "permission_change", re: /\b(?:bypass|skip|disable|ignore|override)\b[^.\n]{0,30}\b(?:permissions?|access\s+(?:checks?|rules?|control)|security|authori[sz]ation|confirmation|the\s+review|review\s+step)\b/i },
];

export interface Classification { allowed: boolean; category?: ExclusionCategory }

/** A single short how-to question ("How do I check stock levels?"). */
export const HOW_TO = /^\s*(?:how\s+(?:do|can|should|would)\s+(?:i|we|you)|how\s+to|where\s+(?:do|can|would|is|are)\s+(?:i|we|the)|what(?:'s| is) the (?:way|process|steps?)\b)[^\n]{0,280}$/i;

/**
 * `howTo`: the person is asking HOW to do something in the app (the help action only). A one-line how-to question that merely names another module ("How do I
 * book inventory?") is guidance, not a request for that module's records, so the other-modules rule alone is relaxed for it. Every other rule (payroll, leave, SQL,
 * credentials, deletion...) still applies, and so does the other-modules rule for anything that is not a single how-to line.
 */
export function classifyRequest(text: string, opts: { howTo?: boolean } = {}): Classification {
  const t = text.normalize("NFKC");
  const howTo = !!opts.howTo && HOW_TO.test(t) && t.length <= 300;
  for (const r of RULES) if (r.re.test(t) && !(howTo && r.category === "other_modules")) return { allowed: false, category: r.category };
  return { allowed: true };
}

export const EXCLUSION_MESSAGE =
  "JARVIS cannot help with that. It never reads or changes salaries, leave, payroll, other modules' records, the database, source code, credentials, settings, deployments or permissions, and it never deletes records or audit history. If this is a genuine brief, remove that sentence and paste it again.";
