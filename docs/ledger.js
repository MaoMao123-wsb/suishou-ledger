const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STATE_KEYS = ['version', 'currency', 'accounts', 'transactions', 'settings'];
const ACCOUNT_KEYS = ['id', 'name', 'color', 'openingBalance', 'monthlyAllowance', 'allowanceMonth'];
const TRANSACTION_KEYS = ['id', 'type', 'amount', 'accountId', 'toAccountId', 'purpose', 'date', 'createdAt'];

function fail(message) {
  throw new Error(message);
}

function record(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label}格式不正确`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail(`${label}含有不安全的字段`);
    if (!Object.hasOwn(descriptors[key], 'value')) fail(`${label}不能包含动态属性`);
    if (allowedKeys && !allowedKeys.includes(key)) fail(`${label}含有不支持的字段：${key}`);
  }
  return value;
}

function string(value, label, maxLength = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) fail(`${label}不能为空，且不能超过${maxLength}个字符`);
  return value.trim();
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || FORBIDDEN_KEYS.has(value)) fail(`${label}不正确`);
  return value;
}

function cents(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) fail(`${label}必须是${allowZero ? '非负' : '正'}的安全整数分`);
  return value;
}

function add(a, b, label = '金额合计') {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail(`${label}超出可支持的金额范围`);
  return result;
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isoDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !isRealDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return false;
  if (match[5] !== 'Z' && (+match[6] > 23 || +match[7] > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function cleanJSON(value, depth = 0, seen = new WeakSet()) {
  if (depth > 30) fail('设置内容层级过多');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') fail('设置含有无法保存的内容');
  if (seen.has(value)) fail('设置不能包含循环引用');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/.test(key))) fail('设置数组含有不安全的字段');
    result = Array.from(value, (item) => cleanJSON(item, depth + 1, seen));
  } else {
    record(value, '设置');
    result = {};
    for (const key of Object.keys(value)) result[key] = cleanJSON(value[key], depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function validateAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) fail('至少需要一个账户');
  const ids = new Set();
  return accounts.map((value) => {
    record(value, '账户', ACCOUNT_KEYS);
    const id = identifier(value.id, '账户编号');
    if (ids.has(id)) fail('账户编号不能重复');
    ids.add(id);
    const name = string(value.name, '账户名称', 40);
    if (typeof value.color !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value.color)) fail('账户颜色不正确');
    const account = { id, name, color: value.color, openingBalance: cents(value.openingBalance, '起始余额', true) };
    if (value.monthlyAllowance !== undefined) {
      account.monthlyAllowance = cents(value.monthlyAllowance, '每月固定额度');
      if (value.allowanceMonth !== undefined) {
        if (typeof value.allowanceMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.allowanceMonth)) fail('额度月份不正确');
        account.allowanceMonth = value.allowanceMonth;
      }
    }
    return account;
  });
}

function calculateBalances(state) {
  const balances = {};
  let total = 0;
  for (const account of state.accounts) {
    balances[account.id] = account.openingBalance;
    total = add(total, account.openingBalance, '总余额');
  }
  for (const tx of state.transactions) {
    if (tx.type === 'income') {
      balances[tx.accountId] = add(balances[tx.accountId], tx.amount, '账户余额');
      total = add(total, tx.amount, '总余额');
    } else {
      balances[tx.accountId] = add(balances[tx.accountId], -tx.amount, '账户余额');
      if (tx.type === 'transfer') balances[tx.toAccountId] = add(balances[tx.toAccountId], tx.amount, '账户余额');
      else total = add(total, -tx.amount, '总余额');
    }
  }
  return balances;
}

export function createInitialState() {
  return {
    version: 1,
    currency: 'CNY',
    accounts: [
      { id: 'wx', name: '微信', color: '#16A36F', openingBalance: 0 },
      { id: 'ali', name: '支付宝', color: '#357DE8', openingBalance: 0 },
      { id: 'bank', name: '银行卡', color: '#875AD7', openingBalance: 0 },
      { id: 'cash', name: '现金', color: '#D29127', openingBalance: 0 },
    ],
    transactions: [],
    settings: {},
  };
}

export function moneyToCents(value) {
  if (typeof value !== 'string') fail('请输入金额文字');
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) fail('金额格式不正确，最多保留两位小数');
  let result = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
  if (match[1] === '-') result = -result;
  if (result > MAX_CENTS || result < -MAX_CENTS) fail('金额超出可支持的范围');
  return Number(result);
}

export function formatMoney(value) {
  if (!Number.isSafeInteger(value)) fail('金额必须是安全整数分');
  const absolute = Math.abs(value);
  return `${value < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function localDate(value = new Date()) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('日期不正确');
  const result = `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (!isRealDate(result)) fail('日期超出可支持的范围');
  return result;
}

export function validateTransaction(value, accounts) {
  const checkedAccounts = validateAccounts(accounts);
  record(value, '账目', TRANSACTION_KEYS);
  const id = identifier(value.id, '账目编号');
  if (!['expense', 'income', 'transfer'].includes(value.type)) fail('账目类型不正确');
  const amount = cents(value.amount, '账目金额');
  const accountId = identifier(value.accountId, '账户编号');
  const ids = new Set(checkedAccounts.map((account) => account.id));
  if (!ids.has(accountId)) fail('账目引用了不存在的账户');
  const result = { id, type: value.type, amount, accountId };
  if (value.type === 'transfer') {
    const toAccountId = identifier(value.toAccountId, '转入账户编号');
    if (!ids.has(toAccountId)) fail('转入账户不存在');
    if (toAccountId === accountId) fail('转出和转入账户不能相同');
    result.toAccountId = toAccountId;
  } else if (value.toAccountId !== undefined) {
    fail('只有转账记录可以设置转入账户');
  }
  result.purpose = string(value.purpose, '用途', 300);
  if (!isRealDate(value.date)) fail('账目日期不正确，请使用真实的年-月-日');
  result.date = value.date;
  if (!isoDateTime(value.createdAt)) fail('账目创建时间不正确');
  result.createdAt = value.createdAt;
  return result;
}

export function validateState(value) {
  record(value, '账本', STATE_KEYS);
  if (value.version !== 1) fail('账本版本不受支持');
  if (value.currency !== 'CNY') fail('账本目前只支持人民币');
  const accounts = validateAccounts(value.accounts);
  if (!Array.isArray(value.transactions)) fail('账目列表格式不正确');
  const ids = new Set();
  const months = new Map();
  const transactions = value.transactions.map((item) => {
    const tx = validateTransaction(item, accounts);
    if (ids.has(tx.id)) fail('账目编号不能重复');
    ids.add(tx.id);
    if (tx.type !== 'transfer') {
      const key = `${tx.date.slice(0, 7)}:${tx.type}`;
      months.set(key, add(months.get(key) || 0, tx.amount, '月度收支合计'));
    }
    return tx;
  });
  record(value.settings, '设置');
  const settings = cleanJSON(value.settings);
  if (Object.hasOwn(settings, 'setupDone') && typeof settings.setupDone !== 'boolean') fail('账户初始化设置必须是布尔值');
  if (Object.hasOwn(settings, 'startDate') && !isRealDate(settings.startDate)) fail('开始记账日期不正确');
  if (Object.hasOwn(settings, 'lastBackupAt') && !isoDateTime(settings.lastBackupAt)) fail('最近备份时间不正确');
  const result = { version: 1, currency: 'CNY', accounts, transactions, settings };
  calculateBalances(result);
  return result;
}

export function getBalances(state, monthKey = localDate().slice(0, 7)) {
  if (typeof monthKey !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) fail('月份不正确');
  const checked = validateState(state);
  const monthly = new Set(checked.accounts.filter((account) => account.monthlyAllowance !== undefined).map((account) => account.id));
  const inMonth = (tx) => tx.date.startsWith(`${monthKey}-`);
  const balances = {};
  for (const account of checked.accounts) {
    balances[account.id] = account.openingBalance;
  }
  for (const tx of checked.transactions) {
    const fromMonthly = monthly.has(tx.accountId);
    const toMonthly = tx.toAccountId ? monthly.has(tx.toAccountId) : false;
    if (tx.type === 'income') {
      if (!fromMonthly || inMonth(tx)) balances[tx.accountId] = add(balances[tx.accountId], tx.amount, '账户余额');
    } else {
      if (!fromMonthly || inMonth(tx)) balances[tx.accountId] = add(balances[tx.accountId], -tx.amount, '账户余额');
      if (tx.type === 'transfer' && (!toMonthly || inMonth(tx))) balances[tx.toAccountId] = add(balances[tx.toAccountId], tx.amount, '账户余额');
    }
  }
  return balances;
}

export function getTotalBalance(state, monthKey = localDate().slice(0, 7)) {
  const total = Object.values(getBalances(state, monthKey)).reduce((sum, balance) => sum + BigInt(balance), 0n);
  if (total > MAX_CENTS || total < -MAX_CENTS) fail('总余额超出可支持的金额范围');
  return Number(total);
}

export function getMonthSummary(state, monthYYYYMM) {
  if (typeof monthYYYYMM !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYYYYMM) || monthYYYYMM.startsWith('0000')) fail('月份不正确');
  const checked = validateState(state);
  let income = 0;
  let expense = 0;
  for (const tx of checked.transactions) {
    if (!tx.date.startsWith(`${monthYYYYMM}-`)) continue;
    if (tx.type === 'income') income = add(income, tx.amount);
    if (tx.type === 'expense') expense = add(expense, tx.amount);
  }
  return { income, expense, net: add(income, -expense) };
}

export function putTransaction(state, transaction) {
  const checked = validateState(state);
  const tx = validateTransaction(transaction, checked.accounts);
  const index = checked.transactions.findIndex((item) => item.id === tx.id);
  if (index < 0) checked.transactions.push(tx);
  else checked.transactions[index] = tx;
  return validateState(checked);
}

export function removeTransaction(state, id) {
  identifier(id, '账目编号');
  const checked = validateState(state);
  checked.transactions = checked.transactions.filter((tx) => tx.id !== id);
  return validateState(checked);
}
