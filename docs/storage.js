const DB_NAME = 'suishou-ledger';
const STORE = 'documents';
let dbPromise;
function db() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('这个浏览器暂不支持本机保存，请用 Safari 打开。'));
  return dbPromise ||= new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(new Error('无法打开本机账本，请检查浏览器的存储权限。'));
    req.onblocked=()=>reject(new Error('请关闭其他随手账页面后重试。'));
  });
}
export async function loadDocument() {
  const d=await db();
  return new Promise((resolve,reject)=>{
    const tx=d.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).get('ledger');
    req.onsuccess=()=>resolve(req.result||{revision:0,state:null});
    req.onerror=()=>reject(new Error('读取账本失败，请重试。'));
  });
}
export async function saveDocument(state,expectedRevision) {
  const d=await db();
  return new Promise((resolve,reject)=>{
    const tx=d.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    let conflict=false;
    let document;
    const req=store.get('ledger');
    req.onsuccess=()=>{
      const revision=req.result?.revision||0;
      if(revision!==expectedRevision){conflict=true;tx.abort();return;}
      document={revision:revision+1,state,updatedAt:new Date().toISOString()};
      store.put(document,'ledger');
    };
    tx.oncomplete=()=>resolve(document);
    tx.onerror=()=>reject(new Error('保存失败，可能是手机存储空间不足。当前内容尚未保存，请先备份。'));
    tx.onabort=()=>reject(new Error(conflict?'另一个页面刚修改了账本，请刷新后再操作。':'保存未完成，请重试。'));
  });
}
