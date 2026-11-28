// "EXPORTEER NAAR ATTOH" — bookmarklet voor de bestseller-pagina's van Temu
// (en AliExpress) (28-11-2026).
//
// Waarom een bookmarklet: Temu zet zijn best-sellers-pagina achter een
// bot-verificatie (puzzel). Die lost Justin zelf op in zijn eigen browser;
// daarna klikt hij op deze knop in zijn bladwijzerbalk. De knop:
//   1. leest alle productkaarten die op dat moment geladen zijn. Meer nodig?
//      Justin klikt zelf eerst een paar keer op "See more" — automatisch
//      klikken laat Temu direct weer de puzzel tonen (getest 28-11);
//   2. leest per productkaart: link + goods-id, titel, prijs, "10K+ sold",
//      aantal reviews en de foto;
//   3. leest welke periode (30/14/7 dagen) en welke categorie aanstaat;
//   4. opent Attoh Tools → Trend Scraper met de lijst in de URL-hash
//      (#export=…). Die pagina zet ze als resultaten neer → aanvinken →
//      import-wachtrij → Importer.
// Geen login/wachtwoorden, geen verificatie omzeilen: het leest alleen wat
// Justin zelf op zijn scherm heeft staan.

export function bestsellerBookmarkletSource(base) {
  const code = `(async()=>{try{
const BASE=${JSON.stringify(base)};
const host=location.hostname;
const src=/aliexpress/.test(host)?'aliexpress':(/temu/.test(host)?'temu':'');
if(!src){alert('Open eerst een Temu- of AliExpress-pagina met producten.');return;}

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const idRe=src==='temu'?/-g-(\\d{6,})\\.html|goods_id=(\\d{6,})/:/\\/item\\/(\\d{6,})\\.html/;
const box=document.createElement('div');
box.style.cssText='position:fixed;z-index:2147483647;top:12px;right:12px;background:#111;color:#fff;font:600 14px/1.4 system-ui;padding:12px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)';
document.body.appendChild(box);
const say=(t)=>{box.textContent='Attoh export · '+t;};
const found=new Map();
const cardOf=(a)=>{let c=a;for(let i=0;i<9&&c;i++){c=c.parentElement;if(!c)break;const tx=c.innerText||'';if(c.querySelector('img')&&/[$€£]|US\\s?\\$/.test(tx)&&tx.length<900)return c;}return a.parentElement;};
const collect=()=>{for(const a of document.querySelectorAll('a[href]')){const m=(a.getAttribute('href')||'').match(idRe);if(!m)continue;const id=m[1]||m[2];if(found.has(id))continue;const c=cardOf(a);if(!c)continue;const raw=(c.innerText||'');const tx=raw.replace(/\\s*\\n\\s*/g,' ');
const pm=tx.match(/(?:US\\s?)?[$€£]\\s?(\\d[\\d,]*)\\s?(\\.\\s?\\d{1,2})?/);const price=pm?parseFloat((pm[1]+(pm[2]||'')).replace(/[,\\s]/g,'')):0;
const sm=tx.match(/(\\d[\\d.,]*\\s?[KkMm]?\\+?)\\s*sold/i);
const lines=raw.split(/\\n+/).map(s=>s.trim()).filter(Boolean);
let rev=0;for(const l of lines){if(/^\\(?\\d[\\d,]*\\)?$/.test(l)){const n=parseInt(l.replace(/\\D/g,''),10);if(n>rev&&n<10000000)rev=n;}}
const img=c.querySelector('img');const isrc=img?(img.currentSrc||img.src||img.getAttribute('data-src')||''):'';
let title=a.getAttribute('title')||a.getAttribute('aria-label')||(img&&img.alt)||'';
if(!title||title.length<8||/^item picture/i.test(title)){title=lines.filter(l=>l.length>14&&!/sold|[$€£]|^local warehouse$|^top pick$|best-selling|top rated|star store|lightning|black friday encore/i.test(l)).sort((x,y)=>y.length-x.length)[0]||title;}
let href=a.href.split('?')[0];
found.set(id,{id,u:href,t:title.slice(0,240),p:price,s:sm?sm[1].replace(/\\s/g,'')+' sold':'',r:rev,i:isrc});}};
say('producten lezen…');
collect();
const items=[...found.values()];
if(!items.length){say('geen producten gevonden op deze pagina');setTimeout(()=>box.remove(),6000);return;}
let period='';{const bs=[...document.querySelectorAll('button,div,span,a')].filter(e=>e.children.length<=2&&/^Within last (\\d+) days$/i.test((e.textContent||'').trim()));const groups={};for(const e of bs){const cls=String(e.className||'').trim().split(/\\s+/);const k=cls[0]||e.tagName;(groups[k]=groups[k]||[]).push({e,n:cls.length,sel:e.getAttribute('aria-selected')==='true'||e.getAttribute('aria-pressed')==='true'});}
for(const g of Object.values(groups)){const sel=g.find(x=>x.sel);if(sel){period=sel.e.textContent.match(/(\\d+)/)[1];break;}const max=Math.max(...g.map(x=>x.n));const top=g.filter(x=>x.n===max);if(g.length>1&&top.length===1){period=top[0].e.textContent.match(/(\\d+)/)[1];break;}}}
let category='';const cat=[...document.querySelectorAll('div,span,button')].find(e=>e.children.length<2&&/^Filter by category$/i.test((e.textContent||'').trim()));
if(cat){let n=cat.nextElementSibling||(cat.parentElement&&cat.parentElement.nextElementSibling);if(n)category=(n.innerText||'').trim().split('\\n')[0];}
if(!category){const w=items.filter(x=>/\\bwomen|ladies/i.test(x.t)).length,m=items.filter(x=>/\\bmen'?s?\\b/i.test(x.t)&&!/women/i.test(x.t)).length;category=w>m*2?"Women's Clothing":m>w*2?"Men's Clothing":'';}
category=prompt('Categorie (bijv. Women\\'s Clothing / Men\\'s Clothing):',category)||category;
period=prompt('Welke periode is dit? (30 / 14 / 7 dagen) — leeg laten mag',period||'')||'';
const payload={source:src,period,category,pageUrl:location.origin+location.pathname,items};
say(items.length+' producten → Attoh Tools…');
const url=BASE+'/trend-scraper#export='+encodeURIComponent(JSON.stringify(payload));
const w=window.open(url,'_blank');if(!w){location.href=url;}
setTimeout(()=>box.remove(),4000);
}catch(e){alert('Attoh export mislukt: '+e.message);}})();`;
  return "javascript:" + encodeURIComponent(code);
}
