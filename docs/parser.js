// All interpretation stays on this device. Any ambiguity is returned for review.
const DEFAULT_ACCOUNT_NAMES = {
  微信: ['微信', '微信钱包', '微信零钱'],
  支付宝: ['支付宝'],
  银行卡: ['银行卡', '银行账户', '储蓄卡'],
  现金: ['现金', '现金账户'],
};

function localDate() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateString(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // setUTCFullYear also handles years 1–99 without Date's 1900 offset.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(12, 0, 0, 0);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? dateString(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function offsetDate(today, offset) {
  const [year, month, day] = today.split('-').map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day + offset);
  value.setUTCHours(12, 0, 0, 0);
  return dateString(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(/，/g, ',').trim();
}

function mask(text, spans) {
  const chars = text.split('');
  for (const { start, end } of spans) {
    for (let i = start; i < end; i += 1) chars[i] = ' ';
  }
  return chars.join('');
}

function matches(text, expression) {
  return [...text.matchAll(expression)].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0], match }));
}

function readDates(text, today, issues) {
  const found = [];
  const year = Number(today.slice(0, 4));
  const expression = /\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|大前天|前天|昨天|昨日|今天|今日|明天|后天/g;
  const offsets = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 今天: 0, 今日: 0, 明天: 1, 后天: 2 };
  for (const span of matches(text, expression)) {
    const dateText = span.text.replace(/\s/g, '');
    let date;
    if (Object.hasOwn(offsets, dateText)) {
      date = offsetDate(today, offsets[dateText]);
    } else {
      const digits = dateText.match(/\d+/g).map(Number);
      date = digits.length === 3 ? dateString(...digits) : dateString(year, ...digits);
    }
    if (!date) issues.push(`日期“${span.text}”无效，请选择真实日期`);
    found.push({ ...span, date });
  }
  if (found.length > 1) issues.push('识别到多个日期，请只记录一天的一笔账');
  const withoutKnownDates = mask(text, found);
  if (/(?:上|下|这|本)(?:周|星期|个月)|\d+天前|\d+天后|年初|月底|月初|去年|明年/.test(withoutKnownDates)) {
    issues.push('这句中的日期暂不能准确识别，请直接选择日期');
  }
  return { spans: found, date: found.find((item) => item.date)?.date ?? today };
}

function accountMentions(text, accounts) {
  const aliases = new Map();
  const add = (name, id) => {
    const normalized = normalize(name);
    if (!normalized) return;
    if (!aliases.has(normalized)) aliases.set(normalized, new Set());
    aliases.get(normalized).add(id);
  };
  for (const account of accounts) {
    if (!account || !account.id || !account.name) continue;
    const name = normalize(account.name);
    add(name, account.id);
    if (DEFAULT_ACCOUNT_NAMES[name]) {
      for (const alias of DEFAULT_ACCOUNT_NAMES[name]) add(alias, account.id);
    }
  }
  // A generic platform name can identify one custom-named account. Multiple
  // matching custom accounts remain ambiguous instead of picking the first.
  for (const generic of Object.keys(DEFAULT_ACCOUNT_NAMES)) {
    if (aliases.has(generic)) continue;
    for (const account of accounts) {
      if (account?.id && normalize(account.name).includes(generic)) add(generic, account.id);
    }
  }
  const possible = [];
  for (const [alias, ids] of aliases) {
    let start = text.indexOf(alias);
    while (start !== -1) {
      possible.push({ start, end: start + alias.length, text: alias, ids: [...ids] });
      start = text.indexOf(alias, start + alias.length);
    }
  }
  possible.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  for (const span of possible) {
    if (selected.some((other) => span.start < other.end && span.end > other.start)) continue;
    selected.push(span);
  }
  return selected;
}

function readAmount(text, excluded, issues) {
  const amountText = mask(text, excluded);
  const candidates = matches(amountText, /[-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)/g);
  if (candidates.length === 0) {
    issues.push('没有识别到金额，请输入数字金额');
    return { amount: null, spans: [] };
  }
  if (candidates.length > 1) {
    issues.push('识别到多个金额，请一次只记录一笔账');
    return { amount: null, spans: candidates };
  }
  if (/\d(?:\.\d+)?\s*(?:[十百千万亿角毛分%％]|[wk](?=\s|元|块|$))/i.test(amountText)) {
    issues.push('金额单位暂不能准确识别，请写完整数字和元，例如 1000.50 元');
    return { amount: null, spans: candidates };
  }
  const raw = candidates[0].text.replace(/,/g, '');
  if (!/^\+?\d+(?:\.\d{1,2})?$/.test(raw)) {
    issues.push('金额必须大于零，且最多保留两位小数');
    return { amount: null, spans: candidates };
  }
  const [whole, decimals = ''] = raw.replace(/^\+/, '').split('.');
  // Parse each decimal part separately; never multiply a floating-point amount.
  const amount = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    issues.push('金额必须大于零，并在可安全记录的范围内');
    return { amount: null, spans: candidates };
  }
  return { amount, spans: candidates };
}

function readCurrency(text, issues) {
  const currencies = new Set();
  const definitions = [
    ['CNY', /人民币|RMB|CNY|[¥￥]|(?<!美|欧|日|港|澳|加|新西兰|新台|韩|英|瑞士法)元|块钱|块/gi],
    ['USD', /美元|美金|USD|US\$|\$|(?<=\d)\s*刀/gi],
    ['EUR', /欧元|EUR|€/gi],
    ['HKD', /港元|港币|HKD/gi],
    ['JPY', /日元|日币|JPY/gi],
    ['GBP', /英镑|GBP|£/gi],
    ['OTHER', /澳元|加元|加币|新西兰元|纽币|新台币|台币|韩元|韩币|瑞士法郎|新加坡元|新币|澳币|澳门元|澳门币/gi],
  ];
  for (const [currency, expression] of definitions) {
    if (expression.test(text)) currencies.add(currency);
  }
  if (currencies.size > 1) issues.push('识别到多种货币，第一版请只记录人民币');
  if ([...currencies].some((currency) => currency !== 'CNY')) issues.push('第一版只支持人民币，请先确认人民币金额');
}

function chooseTransferAccounts(text, mentions, issues) {
  const uncertain = mentions.some((mention) => mention.ids.length !== 1);
  if (uncertain) {
    issues.push('账户名称不明确，请选择转出和转入账户');
    return ['', ''];
  }
  const ids = [...new Set(mentions.flatMap((mention) => mention.ids))];
  if (ids.length > 2) {
    issues.push('识别到两个以上账户，请只记录一次账户转账');
    return ['', ''];
  }
  if (mentions.length === 0) {
    issues.push('请选择转出账户和转入账户');
    return ['', ''];
  }
  const sources = new Set();
  const destinations = new Set();
  for (const mention of mentions) {
    const before = text.slice(Math.max(0, mention.start - 20), mention.start);
    const after = text.slice(mention.end, mention.end + 20);
    if (/(?:从|由|自)\s*$/.test(before) || /^\s*(?:账户|余额|里|中|的)?\s*(?:转出|扣出|扣除|扣款|扣)/.test(after)) sources.add(mention.ids[0]);
    if (/(?:转入|存入|转到|转至|转给|充值到|(?<!收)到|至|给|向)\s*$/.test(before)) destinations.add(mention.ids[0]);
  }
  if (sources.size > 1 || destinations.size > 1) {
    issues.push('转账方向有冲突，请选择转出和转入账户');
    return ['', ''];
  }
  let source = [...sources][0] ?? '';
  let destination = [...destinations][0] ?? '';
  if (ids.length === 2) {
    if (source && !destination) destination = ids.find((id) => id !== source) ?? '';
    if (destination && !source) source = ids.find((id) => id !== destination) ?? '';
    if (!source && !destination) {
      const first = mentions[0];
      const second = mentions.find((mention) => mention.ids[0] !== first.ids[0]);
      const between = text.slice(first.end, second.start);
      if (/收到|接收/.test(between)) {
        source = second.ids[0];
        destination = first.ids[0];
      } else if (/转|到|至|给|向/.test(between) && !/和|或|与/.test(between)) {
        source = first.ids[0];
        destination = second.ids[0];
      }
    }
  } else if (mentions.length > 1 && /转|到|至|给|向/.test(text.slice(mentions[0].end, mentions.at(-1).start))) {
    source = ids[0];
    destination = ids[0];
  }
  if (!source || !destination) issues.push('转账方向不完整，请选择转出账户和转入账户');
  if (source && source === destination) issues.push('转出和转入账户不能相同');
  return [source, destination];
}

function cleanPurpose(text, spans, type) {
  let purpose = mask(text, spans)
    .replace(/人民币|RMB|CNY|[¥￥]|块钱|元|块/gi, ' ')
    .replace(/记录一下|记一笔|记账|支付了|支付|付款|付的|付了|扣的|扣了|扣款|扣除|到账了|到账|入账了|入账|收款|消费了|消费|花了|支出了|支出|收入/g, ' ');
  if (type === 'transfer') purpose = purpose.replace(/转账|转到|转至|转给|转入|转出|转了|转|提现|充值/g, ' ');
  purpose = purpose.replace(/[\s,，。.;；:：!！?？、]+/g, ' ').trim();
  const prefix = /^(?:从|由|用|通过|到|至|给|向|的|在|里|中|了|付|扣)(?=\s|$)\s*/;
  const suffix = /(?:^|\s)(?:从|由|用|通过|到|至|给|向|的|在|里|中|了|付|扣)$/;
  let previous;
  do {
    previous = purpose;
    purpose = purpose.replace(prefix, '').replace(suffix, '').trim();
  } while (purpose !== previous);
  return purpose;
}

/**
 * Recognize a single CNY transaction. Amounts are integer fen, never floats.
 * Nonempty issues mean the caller must ask for correction before saving.
 */
export function parseSentence(input, accounts = [], today = localDate()) {
  const text = normalize(input);
  const issues = [];
  if (!validDate(String(today))) {
    today = localDate();
    issues.push('基准日期无效，请确认记账日期');
  }
  const dates = readDates(text, today, issues);
  const mentions = accountMentions(text, Array.isArray(accounts) ? accounts : []);
  const cardNumbers = matches(text, /(?:尾号|尾数|卡号)\s*[:：]?\s*\d+(?:[ -]\d+)*/g);
  const times = matches(text, /\d{1,2}:\d{2}(?::\d{2})?/g);
  // Quantities are kept in the purpose, but never used as a money amount.
  const quantities = matches(mask(text, [...dates.spans, ...mentions, ...cardNumbers, ...times]), /\d+(?:\.\d+)?\s*(?:公斤|千克|毫升|公里|厘米|杯|份|个|件|斤|克|盒|瓶|包|次|张|人|顿|套|台|支|本|袋|双|盘|碗|升)(?!元)/g);
  const amounts = readAmount(text, [...dates.spans, ...mentions, ...cardNumbers, ...times, ...quantities], issues);
  readCurrency(text, issues);

  const hasIncome = /工资|薪水|奖金|报销|退款|利息|收入|入账|到账|收款|收钱|收到|收到了|收红包|还我|还钱|赚了|进账|出售|售出|卖出|卖了|卖二手/.test(text);
  const accountIds = [...new Set(mentions.flatMap((mention) => mention.ids))];
  const hasTransfer = /转账|转到|转至|转给|转入|转出|提现|充值|从.+(?:到|给|向)|转\s*[\d¥￥]|转.+(?:到|给|向)/.test(text)
    || (accountIds.length > 1 && /转/.test(text));
  const type = hasTransfer && (accountIds.length > 1 || mentions.length > 1) ? 'transfer'
    : hasIncome ? 'income'
      : /转入|转出/.test(text) ? 'transfer' : 'expense';
  if (hasTransfer && type === 'expense') {
    issues.push('这句可能是对外付款或账户转账，请确认交易类型和用途');
  }
  let accountId = '';
  let toAccountId = '';
  const uncertainChoice = /或者|还是|或是|不确定|不清楚|可能|好像|大概|也许|应该|大约|约莫|左右/.test(text);
  if (uncertainChoice) issues.push('这句含有不确定描述，请确认准确的金额、日期和账户');
  if (/不是|没用|不用|没(?:有)?(?:花|付|支付|扣|转)|未(?:支付|付款|扣款)|取消|撤销|作废|不要记|别记/.test(text)) {
    issues.push('这句含有否定或撤销描述，请确认是否真的发生了这笔收支');
  }
  if (/余额|还剩|还有/.test(mask(text, mentions))) {
    issues.push('账户余额请在账户设置中调整，请确认这里要记的是一笔收支');
  }
  if (type === 'transfer') {
    [accountId, toAccountId] = chooseTransferAccounts(mask(text, [...dates.spans, ...amounts.spans, ...cardNumbers, ...times]), mentions, issues);
  } else if (mentions.some((mention) => mention.ids.length !== 1)) {
    issues.push('账户名称不明确，请选择本笔账的账户');
  } else if (accountIds.length > 1) {
    issues.push('识别到多个账户，请选择本笔账实际使用的账户');
  } else if (accountIds.length === 1) {
    accountId = accountIds[0];
  } else {
    issues.push('没有识别到账户，请选择微信、支付宝、银行卡或现金等账户');
  }
  const purpose = cleanPurpose(text, [...dates.spans, ...mentions, ...amounts.spans, ...cardNumbers, ...times], type) || (type === 'transfer' ? '账户转账' : '');
  if (!purpose) issues.push('没有识别到用途，请补充这笔钱的用途');
  return { type, amount: amounts.amount, purpose, date: dates.date, accountId, toAccountId, issues: [...new Set(issues)] };
}
