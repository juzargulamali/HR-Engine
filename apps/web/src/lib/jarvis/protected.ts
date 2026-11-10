/**
 * Restricted information, in code (rulebook section 3: docs/enginious-os/modules/jarvis-rulebook.md).
 *
 * What a person deliberately types or pastes for a task is theirs to submit: Sales context such as project and company names, the client, agency and end client, the venue,
 * dates, quantities, quoted prices, unit rates and client budgets is ALLOWED to go to the AI provider for that task. A figure is not a reason to refuse.
 *
 * Genuinely restricted material stays inside Enginious OS even when it is pasted: employee documents, salaries and payroll, reimbursements, medical and insurance records,
 * private leave details, personal IDs and bank details, credentials, company financial statements and ledgers, internal costing (cost breakdowns, margins, mark-ups) and
 * embedded files. This file finds that material. It is the CONTENT layer and deliberately not the only one:
 *   1. structure: a provider call can carry only the sources its rulebook entry approves (lib/jarvis/outbound.ts), and those are ONLY what the person typed, the bounded chat
 *      context and fixed preference sentences. Nothing the app reads from the database (records, saved quotes, historical prices, budgets, notes) is ever a source: lookups
 *      are computed and shown inside the app and never call the provider;
 *   2. content: everything that goes out is screened here, and so is what comes back;
 *   3. fail closed: when the screen finds restricted material, nothing is sent and the person provides a clean excerpt or continues manually.
 *
 * Plain data and pure functions: no server imports, no model. Two questions are answered here:
 *   - findProtectedContent(text): does this text CONTAIN restricted material?
 *   - protectedTopic(text):       is the person ASKING to be told something JARVIS does not retrieve (pay, personal data, saved prices, project financials)?
 */
export type ProtectedCategory =
  | "compensation" | "reimbursement" | "medical_insurance" | "personal_id" | "private_leave" | "pricing" | "project_financials" | "credential" | "attachment";

export const PROTECTED_LABEL: Record<ProtectedCategory, string> = {
  compensation: "salary, payroll or employee-document details",
  reimbursement: "reimbursement amounts",
  medical_insurance: "medical or insurance details",
  personal_id: "personal ID or bank details",
  private_leave: "private leave details",
  pricing: "saved quotes, prices, rates or discounts",
  project_financials: "company financial or internal costing figures",
  credential: "a password, key or other credential",
  attachment: "an embedded file",
};

const CURRENCY = "(?:aed|usd|sar|eur|gbp|qar|omr|kwd|bhd|dhs?|dirhams?|riyals?|dollars?|euros?|pounds?)";
/** A money amount: a currency next to a number, a currency symbol, or a number with a k/m suffix. */
const MONEY = new RegExp(`(?:${CURRENCY}\\.?\\s?\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?\\b|[$€£]\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?\\s?${CURRENCY}\\b|\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b|\\b\\d+(?:\\.\\d+)?\\s?(?:k|mn|million)\\b)`, "gi");
const PERCENT = /\b\d+(?:\.\d+)?\s?(?:%|percent\b|per\s?cent\b)/gi;
/** Any number of three or more digits (a figure, when it sits next to a protected word). */
const FIGURE = /\b\d{3,}(?:[.,]\d+)*\b/g;
const PERSONAL = /\b(?:his|her|their|my)\b|[a-z]['’]s\b/i;

const T = {
  compensation: /\b(?:salar(?:y|ies)|payroll|pay\s?slips?|pay\s?checks?|wages?|bonus(?:es)?|gratuity|end[-\s]of[-\s]service|remuneration|compensation\s+package|pay\s+(?:rise|raise|grade|scale)|increment|ctc|housing\s+allowance|transport\s+allowance|allowances?)\b/gi,
  reimbursement: /\b(?:reimburse(?:d|ment|ments)?|expense\s+claims?|claims?\s+(?:amount|total)|petty\s+cash)\b/gi,
};

/** Private facts that are protected whenever they appear at all (no figure needed). */
const MEDICAL = /\b(?:diagnos(?:is|ed|es)|medical\s+(?:reports?|conditions?|certificates?|history|records?|leave|results?|tests?|treatment)|surgery|operation\s+on|pregnan(?:t|cy)|chemo(?:therapy)?|cancer|tumou?r|diabet(?:es|ic)|hiv|mental\s+health|depress(?:ion|ed)|anxiety\s+disorder|psychiatr\w+|prescri(?:bed|ption)|hospitali[sz]ed|admitted\s+to\s+hospital|chronic\s+illness|disabilit(?:y|ies)|insurance\s+(?:polic(?:y|ies)|claims?|cards?|member(?:ship)?)\s*(?:no\.?|number|id|#)|health\s+insurance\s+(?:details|numbers?|cards?|claims?|polic(?:y|ies))|medical\s+insurance\s+(?:details|numbers?|cards?|claims?|polic(?:y|ies)))\b/i;
const LEAVE = /\b(?:sick\s+leave|medical\s+leave|maternity(?:\s+leave)?|paternity(?:\s+leave)?|bereavement(?:\s+leave)?|compassionate\s+leave|unpaid\s+leave|leave\s+without\s+pay)\b/i;
const LEAVE_BALANCE = /\b(?:leave\s+balances?|days?\s+of\s+leave\s+(?:left|remaining)|annual\s+leave\s+(?:balance|entitlement))\b/gi;
const ID_WORD = /\b(?:passport|emirates\s+id|eid\s+(?:no\.?|number)|national\s+id|iqama|visa\s+(?:no\.?|number|file)|labou?r\s+card|residence\s+(?:permit|visa)|driving\s+licen[cs]e|iban|bank\s+account|account\s+(?:no\.?|number)|swift|social\s+security|tax\s+(?:id|number)|trn|id\s+(?:no\.?|number))\b/gi;
/** A token that looks like an identifier: at least six characters with at least five digits. */
const ID_TOKEN = /\b(?=[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{5,33}\b/gi;
const EMIRATES_ID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/;
const CARD = /(?<![\w-])\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}(?![\w-])/;
const BIRTH = /\b(?:date\s+of\s+birth|d\.?o\.?b\.?|born\s+on)\b[^.\n]{0,20}\d/i;
const CREDENTIAL = /\b(?:pass(?:word|code|phrase)|api[\s_-]?key|secret(?:\s+key)?|access\s+token|auth(?:orization)?\s+token|bearer|private\s+key|service[\s_-]?role(?:\s+key)?|pin(?:\s+code)?)\b\s*(?:is|was|=|:)\s*\S{4,}|\bsk-[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const ATTACHMENT = /data:[a-z]+\/[a-z0-9.+-]+;base64,|(?:^|\s)[A-Za-z0-9+/]{240,}={0,2}(?:\s|$)/i;

/** Documents that are restricted whatever they contain. */
const EMPLOYEE_DOC = /\b(?:pay\s?slips?|employment\s+contracts?|offer\s+letters?|salary\s+(?:certificates?|slips?|sheets?)|appraisals?|performance\s+reviews?|disciplinary\s+(?:letters?|records?|notes?)|warning\s+letters?|termination\s+letters?|personnel\s+files?|employee\s+(?:files?|records?|documents?))\b/i;
const FINANCIAL_DOC = /\b(?:financial\s+statements?|balance\s+sheets?|general\s+ledgers?|ledgers?|trial\s+balances?|management\s+accounts|cash\s?flow\s+statements?|profit\s+and\s+loss|p\s?&\s?l|costing\s+(?:sheets?|workbooks?|models?|files?)|cost\s+breakdowns?|internal\s+costings?)\b/i;
/** Internal costing: what a job costs US and what we make on it (not the price or budget a client sees). */
const INTERNAL_COST = /\b(?:internal\s+(?:budgets?|costs?|rates?|prices?)|our\s+(?:own\s+)?(?:costs?|margins?)|cost\s+price|cost\s+to\s+us|supplier\s+costs?|margins?|mark-?ups?|gross\s+profit|net\s+profit|profit(?:ability)?|budget\s+(?:vs\.?|versus)\s+actuals?|actuals?\s+(?:vs\.?|versus)\s+budget|project\s+(?:costs?|expenses?|financials?|spend)|overspend|cost\s+to\s+date)\b/gi;

/** An amount the words explicitly call OUR cost ("Our cost is 85 per item", "cost price 12", "it costs us 40"): restricted with any number, with or without a currency. */
const INTERNAL_EXPLICIT = /\b(?:internal\s+(?:budgets?|costs?|rates?|prices?)|our\s+(?:own\s+|unit\s+|actual\s+|real\s+|net\s+)?costs?|cost\s+price|cost\s+to\s+us|costs?\s+us|supplier\s+(?:costs?|prices?|rates?)|buy(?:ing)?\s+price|purchase\s+(?:cost|price)|we\s+(?:pay|paid|buy|bought)(?:\s+\w+){0,3}\s+(?:at|for))\b/gi;
const ANY_NUMBER = /\b\d+(?:[.,]\d+)*\b/g;
/** Same sentence, and close. */
function nearInSentence(text: string, a: RegExp, b: RegExp, window: number): boolean {
  return text.split(/(?<=[.!?])\s+|\n/).some((s) => near(s, a, b, window));
}

/**
 * A marking that restricts a WHOLE text from external sharing ("External sharing prohibited", "Internal use only", "NDA", "Confidential", "Do not forward"). It is not a
 * detail that can be cut out: a text that carries one is not sent to the provider at all, in any mode, in any edited version, and not as earlier context either. Enforced at
 * the common outbound gate (lib/jarvis/outbound.ts), so no route can bypass it.
 *   - an explicit phrase counts wherever it appears;
 *   - a one-word marking ("Confidential", "Restricted", "Privileged") counts as a heading or a short notice, not inside an ordinary sentence ("parking is restricted");
 *   - a sentence saying the text itself is confidential or under NDA counts.
 */
const SHARING_PHRASE = /\b(?:nda|non-?disclosure\s+agreement|non-?disclosure|internal[\s-]+(?:use[\s-]+)?only|for[\s-]+internal[\s-]+(?:use|eyes|circulation|distribution)|internal[\s-]+(?:circulation|distribution|eyes)[\s-]+only|company[\s-]+internal|external\s+sharing\s+(?:is\s+)?(?:prohibited|forbidden|not\s+(?:allowed|permitted))|(?:prohibited|barred)\s+from\s+external\s+sharing|not\s+(?:for|to\s+be)\s+(?:shared\s+externally|external(?:ly)?\s+(?:sharing|shared|use|distribution|circulation))|do\s+not\s+(?:share|forward|distribute|circulate)|not\s+for\s+(?:distribution|sharing|circulation|onward\s+sharing)|client[-\s]restricted|strictly\s+(?:private|confidential)|private\s+(?:and|&)\s+confidential|under\s+embargo|embargoed)\b/i;
const SHARING_WORD = /\b(?:confidential(?:ity)?|restricted|privileged|classified)\b/i;
const SHARING_STATEMENT = /\b(?:this|the)\s+(?:brief|document|e-?mail|message|information|material|project|text|thread)\b[^.\n]{0,40}\b(?:is|are|remains?|must)\b[^.\n]{0,30}\b(?:confidential|restricted|privileged|embargoed|not\s+be\s+shared)\b/i;
const LABELLED_FIELD = /^\s*[A-Za-z][A-Za-z ]{1,24}:\s*\S/;
export function wholeTextRestricted(raw: string): boolean {
  const text = raw.normalize("NFKC");
  if (SHARING_PHRASE.test(text) || SHARING_STATEMENT.test(text)) return true;
  // The tags the app wraps text in are not content.
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^<\/?[a-z ]+>$/i.test(l));
  return lines.some((l, i) => {
    if (!SHARING_WORD.test(l)) return false;
    const marking = /^\s*(?:classification|status|notice|note|marking|confidentiality|subject|re)\s*:/i.test(l);
    if (LABELLED_FIELD.test(l) && !marking) return false;
    const words = l.replace(/^[^:]{1,24}:\s*/, "").split(/\s+/).length;
    // a short notice line anywhere, or a marking in the heading
    return words <= 4 || (i < 3 && (marking || l.length <= 60) && /[(\[–—-]|^\W*(?:confidential|restricted|privileged|classified)\b|\b(?:confidential|restricted|privileged|classified)\W*$/i.test(l));
  });
}

const WINDOW = 70;
function near(text: string, a: RegExp, b: RegExp, window = WINDOW): boolean {
  const as = [...text.matchAll(new RegExp(a.source, a.flags.includes("g") ? a.flags : `${a.flags}g`))];
  if (as.length === 0) return false;
  const bs = [...text.matchAll(new RegExp(b.source, b.flags.includes("g") ? b.flags : `${b.flags}g`))];
  for (const x of as) for (const y of bs) {
    const xs = x.index!, xe = xs + x[0].length, ys = y.index!, ye = ys + y[0].length;
    const gap = ys >= xe ? ys - xe : xs >= ye ? xs - ye : 0;
    if (gap <= window) return true;
  }
  return false;
}

/**
 * The protected details a text contains (empty = none found). Used on everything that could reach the provider, on every model answer before it is shown, on the free-text
 * fields of a lookup before they are displayed, and on anything a person asks JARVIS to remember.
 * Budgets count as pricing: a client's budget in a brief is read locally for the review card (lib/jarvis/sales/brief-outbound.ts) and never sent.
 */
export function findProtectedContent(raw: string): ProtectedCategory[] {
  const text = raw.normalize("NFKC");
  const found = new Set<ProtectedCategory>();
  if (CREDENTIAL.test(text)) found.add("credential");
  if (ATTACHMENT.test(text)) found.add("attachment");

  if (near(text, T.compensation, MONEY) || near(text, T.compensation, FIGURE, 40) || near(text, T.compensation, PERCENT, 40) || near(text, T.compensation, PERSONAL, 30)) found.add("compensation");
  if (near(text, T.reimbursement, MONEY) || near(text, T.reimbursement, FIGURE, 40)) found.add("reimbursement");
  if (MEDICAL.test(text)) found.add("medical_insurance");
  if (LEAVE.test(text) || near(text, LEAVE_BALANCE, /\b\d+(?:\.\d+)?\b/g, 30)) found.add("private_leave");
  if (EMIRATES_ID.test(text) || IBAN.test(text) || CARD.test(text) || BIRTH.test(text) || near(text, ID_WORD, ID_TOKEN, 40)) found.add("personal_id");

  if (EMPLOYEE_DOC.test(text)) found.add("compensation");
  // Company financials and internal costing. Quoted prices, unit rates, discounts and client budgets are NOT here: they are Sales context the person may submit.
  if (FINANCIAL_DOC.test(text) || nearInSentence(text, INTERNAL_EXPLICIT, ANY_NUMBER, 40) || near(text, INTERNAL_COST, MONEY, 50) || near(text, INTERNAL_COST, PERCENT, 50) || near(text, INTERNAL_COST, FIGURE, 40)) found.add("project_financials");
  return [...found];
}

const ASK = /\b(?:show|list|tell|give|read|get|fetch|export|display|reveal|pull|open|see|view|print|send|share|find|look\s+up|check|compare|summari[sz]e|report|what(?:'s|\s+is|\s+are|\s+was|\s+were)|how\s+much|how\s+many|who(?:'s|\s+is|\s+has|\s+gets?|\s+earns?)|which|when\s+(?:is|was|does|did)|does|did|has|have|is|are|can\s+(?:i|you|we)\s+(?:see|get|have|know))\b/i;
const TOPICS: { category: ProtectedCategory; re: RegExp }[] = [
  { category: "compensation", re: /\b(?:salar(?:y|ies)|payroll|pay\s?slips?|wages?|bonus(?:es)?|gratuity|end[-\s]of[-\s]service|earns?|earning|paid\s+(?:how\s+much|per\s+month)|compensation)\b/i },
  { category: "reimbursement", re: /\b(?:reimbursements?|expense\s+claims?|claims?)\b/i },
  { category: "medical_insurance", re: /\b(?:medical\s+(?:records?|reports?|conditions?|certificates?|history|details)|health\s+insurance|medical\s+insurance|insurance\s+(?:details|polic(?:y|ies)|claims?|cards?|numbers?))\b/i },
  { category: "personal_id", re: /\b(?:passports?|emirates\s+ids?|national\s+ids?|iqama|visa\s+(?:numbers?|copy|copies|details|status)|labou?r\s+cards?|ibans?|bank\s+(?:accounts?|details)|date\s+of\s+birth|home\s+address(?:es)?|personal\s+(?:ids?|details|data|documents?))\b/i },
  { category: "private_leave", re: /\b(?:sick\s+leave|medical\s+leave|maternity|paternity|leave\s+(?:balances?|requests?|records?|history|details|reasons?)|annual\s+leave|days?\s+off|time\s+off|(?:who(?:'s|\s+is)|is\s+\w+)\s+on\s+leave|on\s+leave)\b/i },
  { category: "pricing", re: /\b(?:quot(?:e|es|ed|ation|ations)\s+(?:amounts?|values?|totals?|prices?|figures?)|(?:amount|value|total|price)s?\s+(?:of|on|in|for)\s+(?:the\s+|an?\s+|our\s+|that\s+|this\s+)?(?:quot(?:e|ation)|estimate|proposal)|estimate\s+(?:amounts?|values?|totals?|prices?|figures?)|unit\s+(?:rates?|prices?)|rate\s+cards?|discounts?|margins?|mark-?ups?|how\s+much\s+(?:did|do|does|was|were|is|are)\s+(?:we|i|you|they)\s+(?:quot|estimat|charg|pric)\w*)\b/i },
  { category: "project_financials", re: /\b(?:project\s+(?:budgets?|financials?|costs?|expenses?|profit\w*|spend|margins?)|budget\s+(?:vs\.?|versus)|p\s?&\s?l|profit\s+and\s+loss|(?:spent|spend|cost)\s+on\s+(?:the\s+|this\s+|that\s+)?project)\b/i },
];

/**
 * Is the person asking JARVIS to tell, show or discuss something in a protected area? A request counts when it names the area AND asks for it (a question or a "show/tell/list"
 * verb) or already contains protected details about it. A plain how-to question ("How do I submit a reimbursement?") is not a request for the data: the caller checks that first.
 */
export function protectedTopic(raw: string): ProtectedCategory | null {
  const text = raw.normalize("NFKC");
  const asks = ASK.test(text) || /\?\s*$/.test(text.trim());
  const content = findProtectedContent(text);
  for (const t of TOPICS) {
    if (!t.re.test(text)) continue;
    if (asks || content.includes(t.category)) return t.category;
  }
  return null;
}

/** "salary or payroll details and personal ID or bank details" */
export function describeProtected(categories: readonly ProtectedCategory[]): string {
  const labels = [...new Set(categories)].map((c) => PROTECTED_LABEL[c]);
  return labels.length <= 1 ? (labels[0] ?? "protected details") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
