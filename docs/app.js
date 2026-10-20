import {createInitialState,moneyToCents,formatMoney,localDate,validateState,validateTransaction,getBalances,getTotalBalance,getMonthSummary,putTransaction,removeTransaction} from './ledger.js';
import {parseSentence} from './parser.js';
import {loadDocument,saveDocument} from './storage.js';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={home:'<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/>',list:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/>',wallet:'<path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7"/><path d="M20 12h-5v5h5M17 14.5h.1"/>',settings:'<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',transfer:'<path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4"/>',out:'<path d="M7 7h10v10M17 7 7 17"/>',in:'<path d="M7 7v10h10M7 17 17 7"/>',edit:'<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14l-1 7Z"/>',check:'<path d="m5 12 4 4L19 6"/>',device:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>'};
const icon=name=>`<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]||paths.list}</svg>`;
const fmt=n=>{const [whole,frac]=formatMoney(n).split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+frac;};
const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let state,revision=0,updatedAt='',view='home',month=localDate().slice(0,7),filter='all',query='',draftText='',modalOpen=false,busy=false,toastTimer;
const colors=['#73885d','#6d91a1','#9482ad','#b49257','#ad7f70','#728b87'];
const channel='BroadcastChannel' in window?new BroadcastChannel('suishou-updates'):null;

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4300);}
async function commit(next){
  const clean=validateState(next);
  const doc=await saveDocument(clean,revision);
  state=clean;revision=doc.revision;updatedAt=doc.updatedAt;
  channel?.postMessage({revision});
  render();
}
const accountName=id=>state.accounts.find(a=>a.id===id)?.name||'未选择账户';
const monthLabel=()=>`${Number(month.slice(0,4))} 年 ${Number(month.slice(5,7))} 月`;
const dateLabel=date=>date===localDate()?'今天':`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
function nav(){return [['home','home','总览'],['records','list','明细'],['accounts','wallet','账户']].map(([id,ic,label])=>`<button data-nav="${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${icon(ic)}${label}</button>`).join('');}
function render(){
  const d=new Date();
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><img src="./icon.svg" alt=""><div>随手账<small>YOUR DAILY LEDGER</small></div></div><nav class="side-nav" aria-label="主导航">${nav()}</nav><div class="side-bottom"><div class="device">${icon('device')}账本留在这台设备</div><p>一笔一笔，记下日常。<br>按自己的节奏生活。</p><button class="text-button" data-action="settings">备份与设置 ${icon('chevron')}</button></div></aside><main class="workspace"><div class="main"><div class="mobile-brand"><img src="./icon.svg" alt="">随手账 · YOUR DAILY LEDGER</div><header class="topbar"><div><p class="greeting">${d.getMonth()+1} 月 ${d.getDate()} 日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()]}</p><h1>${view==='home'?'日常有数，心里有底。':view==='records'?'每一笔，都在这里。':'你的钱，各有去处。'}</h1></div><div class="top-actions"><span class="local-badge"><i></i>${navigator.onLine?'本机保存':'离线可记'}</span><button class="icon-button" data-action="settings" aria-label="备份与设置">${icon('settings')}</button><span class="avatar" aria-hidden="true">我</span></div></header>${view==='home'?home():view==='records'?recordsPage():accountsPage()}<footer class="bottom-note"><span>${icon('shield')}账单仅保存在当前设备 · ${updatedAt?'已保存':'准备好记录第一笔'}</span><span>简单记账，认真生活。</span></footer></div></main><nav class="bottom-nav" aria-label="底部导航">${nav()}</nav></div>`;
  $('#app').removeAttribute('aria-busy');
  document.querySelectorAll('.stat-value').forEach(el=>{if(el.scrollWidth>el.clientWidth){const size=parseFloat(getComputedStyle(el).fontSize);el.style.fontSize=Math.max(15,Math.floor(size*el.clientWidth/el.scrollWidth-1))+'px';}});
  const composer=$('#sentence');if(composer)composer.value=draftText;
}
function stats(monthKey=localDate().slice(0,7)){
  const s=getMonthSummary(state,monthKey),total=getTotalBalance(state);
  return `<div class="stats-grid"><section class="stat-card expense-card"><p class="stat-top">${icon('out')}${monthKey===localDate().slice(0,7)?'本月已花':esc(monthLabel())+'支出'}</p><div class="stat-value money"><span class="currency">¥</span>${fmt(s.expense)}</div><p class="stat-foot">${icon('in')}${monthKey===localDate().slice(0,7)?'本月收入':'当月收入'} ¥${fmt(s.income)}</p></section><section class="stat-card balance-card"><p class="stat-top">${icon('wallet')}总余额</p><div class="stat-value money ${total<0?'negative':''}"><span class="currency">¥</span>${fmt(total)}</div><p class="stat-foot">${state.accounts.length} 个账户 · 按已记录的收支计算</p></section></div>`;
}
function home(){
  return `${stats()}<section class="composer card"><div class="section-head"><h2>记一笔<span class="section-eyebrow">花完就记，一句就好</span></h2><button class="text-button" data-action="manual">手动填写 ${icon('chevron')}</button></div><div class="composer-body"><label class="sr-only" for="sentence">用一句话记录收支</label><textarea id="sentence" class="composer-input" rows="2" maxlength="300" placeholder="午饭 28 元，微信付的…" enterkeyhint="done"></textarea></div><div class="composer-footer"><div class="sample-list"><button class="sample" data-example="午饭28元，微信付的">试试：午饭 28 元，微信</button><button class="sample" data-example="工资8000元，到账银行卡">工资 8000，银行卡</button></div><button class="primary" data-action="parse">整理这笔账 ${icon('arrow')}</button></div><p class="composer-hint">本机识别常见短句 · 保存前可核对、修改</p></section><section class="content-section"><div class="section-head"><h2>我的账户</h2><button class="text-button" data-nav="accounts">管理账户 ${icon('chevron')}</button></div><div class="account-grid">${accountCards()}</div></section><section class="content-section"><div class="section-head"><h2>最近几笔</h2><button class="text-button" data-nav="records">查看全部 ${icon('chevron')}</button></div><div class="records-card card">${recordList([...state.transactions].sort(sortRecords).slice(0,5))}</div></section>${backupReminder()}`;
}
function backupReminder(){
  const last=state.settings.lastBackupAt;
  if(!state.transactions.length || (last&&Date.now()-new Date(last).getTime()<7*86400000))return '';
  return `<div class="info-panel"><strong>给账本留一份备份</strong><br>清理网站数据或换手机，可能丢失本机记录。偶尔把备份存到“文件”里，更安心。<br><button class="text-button" data-action="backup">${icon('download')}导出备份</button></div>`;
}
function accountCards(){
  const balances=getBalances(state);
  return state.accounts.map(a=>`<button class="account-card" data-account="${esc(a.id)}"><span class="account-icon" style="--account-bg:${a.color.length===4?'#'+[...a.color.slice(1)].map(c=>c+c).join(''):a.color}19;--account-color:${a.color}">${esc(a.name.slice(0,1))}</span><span class="account-label">${esc(a.name)}</span><span class="account-money money ${balances[a.id]<0?'negative':''}">¥${fmt(balances[a.id])}</span></button>`).join('');
}
const sortRecords=(a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt);
function recordList(records){
  if(!records.length)return `<div class="empty"><div class="empty-mark">${icon('list')}</div><div class="empty-title">${state.transactions.length?'这里还没有记录':'你的第一笔，值得被记下'}</div><p>${state.transactions.length?'试试换个月份或筛选条件。':'在上方写一句话，开始自己的账本。'}</p></div>`;
  return records.map(t=>`<button class="record" data-record="${esc(t.id)}"><span class="record-icon ${t.type}">${icon(t.type==='expense'?'out':t.type==='income'?'in':'transfer')}</span><span class="record-main"><span class="record-title">${esc(t.purpose)}</span><span class="record-sub" style="display:block">${esc(accountName(t.accountId))}${t.type==='transfer'?' → '+esc(accountName(t.toAccountId)):t.type==='income'?' · 收入':' · 支出'}</span></span><span class="record-right"><span class="record-amount money ${t.type==='income'?'income-text':t.type==='transfer'?'transfer-text':''}">${t.type==='expense'?'−':t.type==='income'?'+':''}${fmt(t.amount)}</span><span class="record-day" style="display:block">${dateLabel(t.date)}</span></span></button>`).join('');
}
function recordsPage(){
  const list=state.transactions.filter(t=>t.date.startsWith(month)&&(filter==='all'||t.type===filter)&&(!query||`${t.purpose} ${accountName(t.accountId)} ${accountName(t.toAccountId)}`.toLowerCase().includes(query.toLowerCase()))).sort(sortRecords);
  return `<div class="page-title-row"><h2>收支明细</h2><div class="month-control"><label class="sr-only" for="month">选择月份</label><input id="month" type="month" value="${month}" aria-label="选择月份"></div></div>${stats(month)}<div class="filter-bar" aria-label="交易类型筛选">${[['all','全部'],['expense','支出'],['income','收入'],['transfer','转账']].map(([id,label])=>`<button data-filter="${id}" class="filter-button ${filter===id?'active':''}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><label class="sr-only" for="search">搜索用途或账户</label><input class="search-field" id="search" placeholder="搜索用途或账户" value="${esc(query)}" type="search"><div class="section-head"><span class="muted small">${monthLabel()} · ${list.length} 笔记录</span><button class="text-button" data-action="manual">${icon('plus')}记一笔</button></div><div class="records-card card">${recordList(list)}</div>`;
}
function accountsPage(){
  const total=getTotalBalance(state);
  return `<section class="accounts-page"><div class="page-title-row"><h2>我的账户</h2><button class="text-button" data-action="add-account">${icon('plus')}新增账户</button></div><section class="stat-card balance-card"><p class="stat-top">${icon('wallet')}全部账户总余额</p><div class="stat-value money ${total<0?'negative':''}"><span class="currency">¥</span>${fmt(total)}</div><p class="stat-foot">收入增加余额，支出减少余额，账户转账不改变总额。</p></section><div class="account-grid">${accountCards()}</div><div class="info-panel"><strong>余额，从起点慢慢累积。</strong><br>点开账户可修改名称和起始余额。起始余额是开始记账前已有的钱；之后的变化，用收支或转账记录。${total<0?'<br><strong>账面余额为负，建议检查起始余额或是否漏记收入。</strong>':''}<br><button class="text-button" data-action="transfer">${icon('transfer')}账户间转账</button></div></section>`;
}
let restoreFocus;
function showModal(content,{title='账本操作',wide=false,closable=true}={}){
  restoreFocus=document.activeElement;modalOpen=true;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><h2>${esc(title)}</h2>${closable?`<button class="icon-button" id="close-modal" aria-label="关闭">${icon('close')}</button>`:''}</div>${content}</section></div>`;
  document.body.style.overflow='hidden';
  $('#close-modal')?.addEventListener('click',closeModal);
  $('.modal-backdrop').addEventListener('click',e=>{if(e.target===e.currentTarget&&closable)closeModal();});
  const focusable=$('.modal').querySelector('input,select,textarea,button');
  setTimeout(()=>focusable?.focus({preventScroll:true}),80);
  $('.modal').addEventListener('keydown',e=>{
    if(e.key==='Escape'&&closable){e.preventDefault();closeModal();}
    if(e.key==='Tab'){
      const f=[...$('.modal').querySelectorAll('button:not(:disabled),input:not(:disabled):not([type=hidden]),select,textarea,[tabindex="0"]')].filter(el=>el.offsetParent!==null);
      if(!f.length)return;
      if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===f.at(-1)){e.preventDefault();f[0].focus();}
    }
  });
}
function closeModal(){if(busy)return;$('#modal-root').innerHTML='';modalOpen=false;document.body.style.overflow='';restoreFocus?.isConnected&&restoreFocus.focus({preventScroll:true});}
function formError(error){const el=$('#form-error');if(el){el.textContent=error.message||String(error);el.setAttribute('role','alert');}else toast(error.message||String(error));}
async function formTask(fn){if(busy)return;busy=true;const b=$('#save-button');if(b)b.disabled=true;try{await fn();}catch(e){formError(e);}finally{busy=false;if(b)b.disabled=false;}}
function accountOptions(value,placeholder='请选择账户'){return `<option value="">${placeholder}</option>`+state.accounts.map(a=>`<option value="${esc(a.id)}" ${value===a.id?'selected':''}>${esc(a.name)}</option>`).join('');}
function openEditor(initial={},editing=null){
  let entry={type:'expense',amount:null,purpose:'',date:localDate(),accountId:'',toAccountId:'',...initial};
  function paint(){
    showModal(`<div class="segmented" aria-label="收支类型">${[['expense','支出'],['income','收入'],['transfer','转账']].map(([id,label])=>`<button type="button" data-type="${id}" class="${entry.type===id?'active':''}" aria-pressed="${entry.type===id}">${label}</button>`).join('')}</div>${initial.issues?.length?`<div class="issues">${initial.issues.map(esc).join('<br>')}<br>请在下方核对并补全。</div>`:''}<form id="entry-form"><label class="field amount-field"><span>金额（元）</span><div class="amount-input-wrap"><span>¥</span><input id="amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${entry.amount===null?'':formatMoney(entry.amount)}" required aria-label="金额（元）"></div></label><label class="field"><span>用途</span><input id="purpose" name="purpose" maxlength="80" value="${esc(entry.purpose)}" placeholder="例如：午饭、工资、账户转账" required></label><div class="field-row"><label class="field"><span>${entry.type==='income'?'到账账户':'付款账户'}</span><select id="account" name="accountId" required>${accountOptions(entry.accountId)}</select></label><label class="field"><span>日期</span><input id="date" name="date" type="date" value="${esc(entry.date)}" required></label></div>${entry.type==='transfer'?`<label class="field"><span>转入账户</span><select id="to-account" name="toAccountId" required>${accountOptions(entry.toAccountId,'请选择转入账户')}</select></label>`:''}<p class="small muted">${editing?'修改后会重新计算余额和统计。':'核对金额和账户，再保存到这台设备。'}</p>${initial.issues?.length?'<label class="check-row"><input type="checkbox" id="review-confirm" required>我已核对并修正上方提示，以及下面这笔记录的信息。</label>':''}<div id="form-error" class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" id="cancel-entry">取消</button><button class="primary" type="submit" id="save-button">${icon('check')}${editing?'保存修改':'确认保存'}</button></div></form>${editing?'<button class="delete-button" id="delete-entry">删除这笔记录</button>':''}`,{title:editing?'修改这笔账':'核对这笔账'});
    $('#cancel-entry').onclick=closeModal;
    $('[data-type]')?.parentElement.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{
      entry={...entry,type:b.dataset.type,purpose:$('#purpose').value,date:$('#date').value,accountId:$('#account').value,toAccountId:$('#to-account')?.value||''};
      try{entry.amount=$('#amount').value.trim()?moneyToCents($('#amount').value):null;}catch{entry.amount=null;}
      if(entry.type==='transfer'&&!entry.purpose)entry.purpose='账户转账';paint();
    });
    $('#entry-form').onsubmit=e=>{e.preventDefault();formTask(async()=>{
      const type=entry.type;
      if(initial.issues?.length&&!$('#review-confirm').checked)throw new Error('请先核对识别提示，确认金额、日期和账户。');
      const tx={id:editing?.id||uid(),type,amount:moneyToCents($('#amount').value),purpose:$('#purpose').value.trim(),date:$('#date').value,accountId:$('#account').value,createdAt:editing?.createdAt||new Date().toISOString()};
      if(type==='transfer')tx.toAccountId=$('#to-account').value;
      validateTransaction(tx,state.accounts);
      const next=putTransaction(state,tx);
      await commit(next);draftText='';busy=false;closeModal();render();window.scrollTo({top:0,behavior:'auto'});toast(editing?'这笔账已修改':'记好了，已保存到本机');
    });};
    if(editing)$('#delete-entry').onclick=()=>{
      if(!confirm(`删除“${editing.purpose} ¥${formatMoney(editing.amount)}”？余额和统计也会更新。`))return;
      formTask(async()=>{await commit(removeTransaction(state,editing.id));busy=false;closeModal();toast('记录已删除，余额已更新');});
    };
  }
  paint();
}
function setup(){
  showModal(`<img class="setup-logo" src="./icon.svg" alt=""><p class="modal-intro">先记下各账户已有的钱，之后每笔收支都会自动更新余额。所有金额以人民币记录。</p><form id="setup-form">${state.accounts.map(a=>`<div class="setup-row"><label for="opening-${a.id}">${esc(a.name)}</label><div class="setup-amount"><span>¥</span><input id="opening-${a.id}" data-opening="${a.id}" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="${esc(a.name)}起始余额"></div></div>`).join('')}<p class="section-caption">填写开始记账前的余额。暂时填 0，也可以稍后在“账户”中补上。</p><div id="form-error" class="form-error"></div><button id="save-button" class="primary wide-button" type="submit">开始我的账本 ${icon('arrow')}</button></form><p class="composer-hint">账单保存在当前设备，记得定期导出备份。</p>`,{title:'从今天，开始有数。',closable:false});
  $('#setup-form').onsubmit=e=>{e.preventDefault();formTask(async()=>{
    const accounts=state.accounts.map(a=>({...a,openingBalance:moneyToCents($(`[data-opening="${a.id}"]`).value.trim()||'0')}));
    await commit({...state,accounts,settings:{...state.settings,setupDone:true,startDate:localDate()}});busy=false;closeModal();toast('账本准备好了，记下第一笔吧');
  });};
}
function openAccount(id){
  const old=state.accounts.find(a=>a.id===id);let color=old?.color||colors[state.accounts.length%colors.length];
  showModal(`<form id="account-form"><label class="field"><span>账户名称</span><input id="account-name" maxlength="20" value="${esc(old?.name||'')}" placeholder="例如：招商银行卡" required></label><label class="field"><span>起始余额（元）</span><input id="account-opening" inputmode="decimal" value="${old?formatMoney(old.openingBalance):''}" placeholder="0.00"></label><p class="section-caption">${old?'这是开始记账前的余额，修改会影响当前余额。日常的收入、支出和转账请通过记账记录。':'填写这个账户在开始记录前已有的金额。'}</p><span class="field-label" style="margin-top:22px">账户颜色</span><div class="color-options">${colors.map(c=>`<button type="button" class="color-option ${c===color?'active':''}" data-color="${c}" style="--swatch:${c}" aria-label="选择颜色 ${c}" aria-pressed="${c===color}"></button>`).join('')}</div><div id="form-error" class="form-error"></div><div class="modal-actions"><button type="button" class="secondary" id="cancel-account">取消</button><button id="save-button" class="primary" type="submit">保存账户</button></div></form>${old?'<button class="delete-button" id="delete-account">删除账户</button>':''}`,{title:old?'管理账户':'添加一个账户'});
  $('#cancel-account').onclick=closeModal;
  document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});});
  $('#account-form').onsubmit=e=>{e.preventDefault();formTask(async()=>{
    const name=$('#account-name').value.trim();
    if(state.accounts.some(a=>a.id!==id&&a.name.toLowerCase()===name.toLowerCase()))throw new Error('已经有同名账户，请换个名称。');
    const a={id:old?.id||uid(),name,color,openingBalance:moneyToCents($('#account-opening').value.trim()||'0')};
    await commit({...state,accounts:old?state.accounts.map(x=>x.id===id?a:x):[...state.accounts,a]});busy=false;closeModal();toast('账户已保存');
  });};
  if(old)$('#delete-account').onclick=()=>{
    if(state.accounts.length<=1){formError(new Error('至少保留一个账户。'));return;}
    if(state.transactions.some(t=>t.accountId===id||t.toAccountId===id)){formError(new Error('这个账户已有记账记录，暂不能删除。可以修改名称。'));return;}
    if(!confirm(`删除“${old.name}”？这个账户的起始余额也将从总余额中移除。`))return;
    formTask(async()=>{await commit({...state,accounts:state.accounts.filter(a=>a.id!==id)});busy=false;closeModal();toast('账户已删除');});
  };
}
function downloadFile(content,type,name){
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function exportBackup(){
  try{
    const data=JSON.stringify(state,null,2);
    downloadFile(data,'application/json',`随手账备份-${localDate()}.json`);
    await commit({...state,settings:{...state.settings,lastBackupAt:new Date().toISOString()}});
    toast('备份已生成，请保存到“文件”；恢复时选择这份 JSON');
  }catch(e){toast(e.message);}
}
function exportCSV(){
  const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['日期','类型','金额（元）','用途','付款/入账账户','转入账户'],...state.transactions.slice().sort(sortRecords).map(t=>[t.date,{expense:'支出',income:'收入',transfer:'转账'}[t.type],formatMoney(t.amount),t.purpose,accountName(t.accountId),t.toAccountId?accountName(t.toAccountId):''])];
  downloadFile('\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8',`随手账明细-${localDate()}.csv`);toast('明细已导出；完整恢复请使用 JSON 备份');
}
function settings(){
  showModal(`<p class="modal-intro">账本保存在当前设备、当前浏览器里。导出一份备份，可以在换手机后恢复。</p><div class="backup-list"><button class="setting-tile" id="export-backup">${icon('download')}<span><strong>导出完整备份</strong><small>JSON 文件 · 包含账户、起始余额与全部收支</small></span></button><button class="setting-tile" id="import-backup">${icon('upload')}<span><strong>从备份恢复</strong><small>选择随手账 JSON 备份，核对后替换本机账本</small></span></button><button class="setting-tile" id="export-csv">${icon('list')}<span><strong>导出收支明细</strong><small>CSV 文件 · 便于在表格软件中查看</small></span></button></div><input type="file" class="hidden-input" id="backup-file" accept=".json,application/json"><div class="setting-divider"></div><div class="settings-help"><strong>在 iPhone 上像 App 一样使用</strong><ol><li>用 Safari 打开这个网址。</li><li>点“分享”，再选“添加到主屏幕”。</li><li>在主屏幕首次打开后，完成账户设置；以后从同一个图标进入。</li></ol><p>Safari 与主屏幕图标中的存储可能独立。若需要搬移账本，先导出 JSON，再在目标入口恢复。</p><br><strong>关于本机保存</strong><p>不上传账单，不自动连接支付账户。清理网站数据、无痕浏览或系统清理存储，都可能影响记录。请定期将 JSON 备份存到“文件”中。</p><p style="margin-top:12px">${state.settings.lastBackupAt?'最近生成备份：'+esc(new Date(state.settings.lastBackupAt).toLocaleString('zh-CN')):'还没有生成过完整备份。'}</p><p style="margin-top:12px">随手账 · 个人版 1.0</p></div>`,{title:'备份与使用',wide:true});
  $('#export-backup').onclick=exportBackup;$('#export-csv').onclick=exportCSV;
  $('#import-backup').onclick=()=>$('#backup-file').click();
  $('#backup-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>15*1024*1024)throw new Error('备份文件过大，请选择 15MB 以内的随手账 JSON 文件。');
      const imported=validateState(JSON.parse(await file.text()));
      if(!imported.accounts.length)throw new Error('备份中至少需要一个账户。');
      importReview(imported);
    }catch(err){toast(err instanceof SyntaxError?'这不是有效的 JSON 备份文件。':err.message);e.target.value='';}
  };
}
function importReview(imported){
  const total=getTotalBalance(imported);
  showModal(`<p class="modal-intro">这份备份包含 ${imported.accounts.length} 个账户、${imported.transactions.length} 笔记录。</p><div class="info-panel" style="margin-top:0"><strong>备份中的总余额：¥${fmt(total)}</strong><br>恢复会替换本机现有账本，不会把两份记录叠加。</div>${state.transactions.length?'<button class="text-button" id="backup-before-import" style="margin-top:15px">'+icon('download')+'先导出当前账本</button><label class="check-row"><input type="checkbox" id="import-confirm" required>我已备份当前账本，确认用这份备份替换。</label>':''}<div id="form-error" class="form-error"></div><div class="modal-actions"><button class="secondary" id="cancel-import">取消</button><button class="primary" id="save-button">恢复这份账本</button></div>`,{title:'核对备份后恢复'});
  $('#cancel-import').onclick=closeModal;
  $('#backup-before-import')?.addEventListener('click',exportBackup);
  $('#save-button').onclick=()=>formTask(async()=>{
    if($('#import-confirm')&&!$('#import-confirm').checked)throw new Error('请先备份现有账本，再勾选确认。');
    await commit({...imported,settings:{...imported.settings,setupDone:true}});busy=false;closeModal();toast('账本已恢复，余额已重新计算');
  });
}

$('#app').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.nav){view=b.dataset.nav;render();window.scrollTo({top:0,behavior:'auto'});return;}
  if(b.dataset.account){openAccount(b.dataset.account);return;}
  if(b.dataset.record){const tx=state.transactions.find(t=>t.id===b.dataset.record);if(tx)openEditor(tx,tx);return;}
  if(b.dataset.example){draftText=b.dataset.example;$('#sentence').value=draftText;$('#sentence').focus();return;}
  if(b.dataset.filter){filter=b.dataset.filter;render();return;}
  switch(b.dataset.action){
    case 'settings':settings();break;
    case 'manual':openEditor();break;
    case 'add-account':openAccount();break;
    case 'transfer':openEditor({type:'transfer',purpose:'账户转账'});break;
    case 'backup':exportBackup();break;
    case 'parse':{
      if(!draftText.trim()){toast('先写一句话，例如“午饭28元，微信付的”');$('#sentence').focus();return;}
      try{openEditor(parseSentence(draftText,state.accounts,localDate()));}catch(err){toast(err.message||'这句话暂时没认清，可以点“手动填写”。');}
      break;
    }
  }
});
$('#app').addEventListener('input',e=>{
  if(e.target.id==='sentence')draftText=e.target.value;
  if(e.target.id==='search'){
    query=e.target.value;const position=e.target.selectionStart;render();const s=$('#search');s.focus({preventScroll:true});try{s.setSelectionRange(position,position);}catch{}
  }
});
$('#app').addEventListener('change',e=>{if(e.target.id==='month'&&/^\d{4}-\d{2}$/.test(e.target.value)){month=e.target.value;render();}});
window.addEventListener('online',()=>{if(state)render();});window.addEventListener('offline',()=>{if(state)render();});
channel?.addEventListener('message',async e=>{
  if(e.data.revision<=revision)return;
  if(modalOpen){toast('另一个页面更新了账本，请关闭当前操作后刷新。');return;}
  try{const doc=await loadDocument();state=validateState(doc.state);revision=doc.revision;updatedAt=doc.updatedAt;render();toast('已同步这台设备另一页面的修改');}catch(err){toast(err.message);}
});
async function start(){
  try{
    const doc=await loadDocument();revision=doc.revision;updatedAt=doc.updatedAt||'';
    state=doc.state?validateState(doc.state):createInitialState();render();
    if(!state.settings.setupDone)setup();
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').then(reg=>{
        if(reg.waiting)toast('有新版本，关闭所有随手账页面后重新打开即可更新。');
        reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('新版本已准备好，下次打开时生效。');});});
      }).catch(()=>{/* Online bookkeeping remains available when the host disallows service workers. */});
    }
    navigator.storage?.persist?.().catch(()=>{});
  }catch(err){
    $('#app').innerHTML=`<main class="error-screen"><img class="setup-logo" src="./icon.svg" alt=""><h1>暂时无法打开本机账本</h1><p>${esc(err.message)}<br>现有数据没有被覆盖。请先重试；若曾导出备份，也可以在其他正常的浏览器中恢复。</p><button class="primary" onclick="location.reload()">重新打开</button></main>`;
  }
}
start();
