// Website Change Detector: Express API + scheduler/queue + Playwright worker + SQLite
const express=require('express'),Database=require('better-sqlite3'),{chromium}=require('playwright'),crypto=require('crypto'),fs=require('fs'),dns=require('dns').promises;
const Diff=require('diff'),{PNG}=require('pngjs'),pixelmatch=require('pixelmatch');
const PORT=process.env.PORT||3000,BASE=process.env.BASE_URL||`http://localhost:${PORT}`,TG=process.env.TELEGRAM_BOT_TOKEN;
const mailer=process.env.SMTP_URL?require('nodemailer').createTransport(process.env.SMTP_URL):null;
const DATA=process.env.DATA_DIR||'./data',SH=DATA+'/shots';fs.mkdirSync(SH,{recursive:true});
const db=new Database(DATA+'/app.db');
db.exec(`create table if not exists watches(id integer primary key,name,url,interval_min int,watch_sel default '',ignore_sel default '',sensitivity default 'medium',notify default '',email default '',
 status default 'pending',error,last_checked int,last_changed int,last_hash,fail_count int default 0,next_run int default 0);
create table if not exists snapshots(id integer primary key,watch_id int,hash,text,created_at int);
create index if not exists s_w on snapshots(watch_id,id)`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).catch(()=>{});

// ---- safety: public http(s) pages only (blocks SSRF to private networks)
async function safeUrl(u){const x=new URL(u);if(!/^https?:$/.test(x.protocol))throw Error('Only http(s) URLs');
 const {address}=await dns.lookup(x.hostname);
 if(/^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|f[cd])/i.test(address))throw Error('Private addresses are not allowed');return x}

// ---- noise filtering: timestamps, dates, relative times, counters, random tokens
const NOISE=[/\b\d{1,2}[:.]\d{2}(:\d{2})?\s?(am|pm)?\b/gi,/\b\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?\b/gi,/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g,
 /\b(just now|\d+\s*(seconds?|minutes?|mins?|hours?|days?)\s+ago)\b/gi,/\b[a-f0-9]{16,}\b/gi,/\b[\w+\/-]{24,}={0,2}/g,
 /\b\d[\d,.]*\s*(views?|visitors?|users?|online|likes?|comments?|shares?|reads?)\b/gi];
const normalize=(t,sens)=>t.split('\n').map(l=>{for(const r of NOISE)l=l.replace(r,'');if(sens==='low')l=l.replace(/\d+/g,'');return l.replace(/\s+/g,' ').trim()}).filter(Boolean).join('\n');

// ---- browser worker
let browser;const getBrowser=async()=>browser?.isConnected()?browser:(browser=await chromium.launch({args:['--no-sandbox']}));
const last={};async function throttle(host){const t=Math.max(Date.now(),(last[host]||0)+5000);last[host]=t;await sleep(t-Date.now())} // >=5s between hits per host
const extract=(page,w)=>page.evaluate(({watch,ignore})=>{
 const bad=[...ignore.split('||').filter(Boolean),'script','style','noscript','iframe','[class*=advert]','[id*=advert]','[class*=banner]','[class*=carousel]','ins.adsbygoogle'];
 const hid=[];for(const s of bad){try{document.querySelectorAll(s).forEach(e=>{hid.push([e,e.style.display]);e.style.display='none'})}catch{}}
 const roots=watch?watch.split('||').flatMap(s=>{try{return[...document.querySelectorAll(s)]}catch{return[]}}):[document.body];
 const t=roots.map(e=>e.innerText).join('\n');hid.forEach(([e,d])=>e.style.display=d);return t},{watch:w.watch_sel,ignore:w.ignore_sel});
const BLOCK=/captcha|are you a robot|verify you are human|unusual traffic|access denied|checking your browser/i;

function done(w,status,err){const f=status==='ok'?0:w.fail_count+1;
 db.prepare('update watches set status=?,error=?,last_checked=?,fail_count=?,next_run=? where id=?').run(status,err||null,Date.now(),f,Date.now()+w.interval_min*6e4*2**Math.min(Math.max(f-1,0),4),w.id)}

// One page load serves every watch of the same URL (200 watchers => 1 fetch)
async function runUrl(url,ws){let ctx;
 try{await throttle(new URL(url).host);await safeUrl(url);ctx=await(await getBrowser()).newContext({viewport:{width:1280,height:800}});const page=await ctx.newPage();let resp;
  for(let i=0;i<3;i++){try{resp=await page.goto(url,{timeout:30000,waitUntil:'load'});break}catch(e){if(i==2)throw e;await sleep(2000*2**i)}} // retries w/ backoff
  await page.waitForTimeout(1500);const st=resp?.status()||0,body=(await page.innerText('body').catch(()=>'')).slice(0,3000);
  // Outage / CAPTCHA / bot-wall = status, NOT a content change
  if([403,429].includes(st)||(body.length<2500&&BLOCK.test(body)))return ws.forEach(w=>done(w,'blocked','Blocked or CAPTCHA (HTTP '+st+')'));
  if(st>=400)return ws.forEach(w=>done(w,'error','HTTP '+st));
  const shot=await page.screenshot({fullPage:true});
  for(const w of ws)await record(w,normalize(await extract(page,w),w.sensitivity),shot);
 }catch(e){ws.forEach(w=>done(w,'error',e.message))}finally{await ctx?.close().catch(()=>{})}}

async function record(w,text,shot){const hash=sha(text);done(w,'ok');if(hash===w.last_hash)return; // store only when hash changes
 const prev=db.prepare('select text from snapshots where watch_id=? order by id desc limit 1').get(w.id),prevId=db.prepare('select max(id) m from snapshots where watch_id=?').get(w.id).m;
 const seen=db.prepare('select 1 from snapshots where watch_id=? and hash=?').get(w.id,hash);
 const id=db.prepare('insert into snapshots(watch_id,hash,text,created_at) values(?,?,?,?)').run(w.id,hash,text,Date.now()).lastInsertRowid;
 fs.writeFileSync(`${SH}/${id}.png`,shot);db.prepare('update watches set last_hash=?,last_changed=? where id=?').run(hash,Date.now(),w.id);
 if(!prev)return;const parts=Diff.diffLines(prev.text,text),ch=parts.filter(p=>p.added||p.removed).reduce((n,p)=>n+p.count,0);
 const total=Math.max(prev.text.split('\n').length,text.split('\n').length);
 // no endless alerts: skip A->B->A flapping (hash seen before) and changes below the sensitivity threshold
 if(seen||ch/total<{low:.1,medium:.02,high:0}[w.sensitivity])return;
 const added=parts.filter(p=>p.added).map(p=>p.value.trim()).join(' / ').slice(0,200);
 notify(w,`${ch} line(s) changed. ${added?'New: '+added:''}`,`${BASE}/#/w/${w.id}/${prevId}/${id}`)}

async function notify(w,summary,link){const msg=`🔔 ${w.name} changed\n${summary}\n${link}`;
 if(/^https:\/\/discord/.test(w.notify))post(w.notify,{content:msg});
 else if(/^tg:/.test(w.notify)&&TG)post(`https://api.telegram.org/bot${TG}/sendMessage`,{chat_id:w.notify.slice(3),text:msg});
 else if(/^https?:/.test(w.notify))post(w.notify,{text:msg});
 if(w.email&&mailer)mailer.sendMail({from:process.env.MAIL_FROM,to:w.email,subject:`Changed: ${w.name}`,text:msg}).catch(()=>{})}

// ---- scheduler + job queue (2 concurrent jobs, 90s job timeout)
let busy=false;async function tick(){if(busy)return;busy=true;
 try{const g={};db.prepare('select * from watches where next_run<=?').all(Date.now()).forEach(w=>(g[w.url]??=[]).push(w));const q=Object.entries(g);
  await Promise.all([0,1].map(async()=>{while(q.length){const[u,ws]=q.shift();await Promise.race([runUrl(u,ws),sleep(9e4)])}}))}finally{busy=false}}
setInterval(tick,15000);

// ---- API
const app=express();app.use(express.json(),express.static(__dirname+'/public'));
const wrap=f=>(q,s)=>Promise.resolve(f(q,s)).catch(e=>s.status(400).json({error:e.message}));
app.get('/api/watches',(q,s)=>s.json(db.prepare('select * from watches order by id desc').all()));
app.post('/api/watches',wrap(async(q,s)=>{const b=q.body;await safeUrl(b.url);const iv=Math.min(1440,Math.max(15,+b.interval_min||60));
 if(!b.name)throw Error('Name required');const r=db.prepare('insert into watches(name,url,interval_min,watch_sel,ignore_sel,sensitivity,notify,email) values(?,?,?,?,?,?,?,?)')
 .run(b.name,b.url,iv,b.watch_sel||'',b.ignore_sel||'',['low','medium','high'].includes(b.sensitivity)?b.sensitivity:'medium',b.notify||'',b.email||'');s.json({id:r.lastInsertRowid})}));
app.delete('/api/watches/:id',(q,s)=>{db.prepare('delete from watches where id=?').run(q.params.id);db.prepare('delete from snapshots where watch_id=?').run(q.params.id);s.json({ok:1})});
app.post('/api/watches/:id/check',(q,s)=>{db.prepare('update watches set next_run=0 where id=?').run(q.params.id);tick();s.json({ok:1})});
app.get('/api/watches/:id/snapshots',(q,s)=>s.json(db.prepare('select id,created_at,length(text) len from snapshots where watch_id=? order by id desc').all(q.params.id)));
app.get('/api/diff',(q,s)=>{const g=i=>db.prepare('select text from snapshots where id=?').get(i)?.text||'';s.json(Diff.diffLines(g(q.query.a),g(q.query.b)))});
app.get('/api/shot/:id',(q,s)=>s.sendFile(require('path').resolve(`${SH}/${+q.params.id}.png`)));
app.get('/api/imgdiff',(q,s)=>{const rd=i=>PNG.sync.read(fs.readFileSync(`${SH}/${+i}.png`)),A=rd(q.query.a),B=rd(q.query.b),w=Math.min(A.width,B.width),h=Math.min(A.height,B.height);
 const crop=P=>{const o=new PNG({width:w,height:h});PNG.bitblt(P,o,0,0,w,h,0,0);return o},out=new PNG({width:w,height:h});
 pixelmatch(crop(A).data,crop(B).data,out.data,w,h,{threshold:.15});s.type('png').send(PNG.sync.write(out))}); // changed pixels highlighted red
app.get('/api/watches/:id/rss',(q,s)=>{const w=db.prepare('select * from watches where id=?').get(q.params.id);if(!w)return s.sendStatus(404);
 const it=db.prepare('select id,created_at from snapshots where watch_id=? order by id desc limit 30').all(w.id).map(x=>`<item><title>${w.name} changed</title><link>${BASE}/#/w/${w.id}</link><guid>${x.id}</guid><pubDate>${new Date(x.created_at).toUTCString()}</pubDate></item>`).join('');
 s.type('xml').send(`<?xml version="1.0"?><rss version="2.0"><channel><title>${w.name}</title><link>${BASE}</link><description>${w.url}</description>${it}</channel></rss>`)});
// visual picker backend: screenshot of the page, and click (x,y) -> CSS selector
app.get('/api/preview',wrap(async(q,s)=>{await safeUrl(q.query.url);const c=await(await getBrowser()).newContext({viewport:{width:1280,height:800}}),p=await c.newPage();
 try{await p.goto(q.query.url,{timeout:30000});await p.waitForTimeout(1500);s.type('png').send(await p.screenshot())}finally{await c.close()}}));
app.post('/api/pick',wrap(async(q,s)=>{await safeUrl(q.body.url);const c=await(await getBrowser()).newContext({viewport:{width:1280,height:800}}),p=await c.newPage();
 try{await p.goto(q.body.url,{timeout:30000});await p.waitForTimeout(1500);
  s.json({selector:await p.evaluate(([x,y])=>{let e=document.elementFromPoint(x,y);const o=[];while(e&&e.nodeType==1&&e!==document.body){let t=e.tagName.toLowerCase();
   if(e.id){o.unshift('#'+CSS.escape(e.id));break}const sib=[...e.parentNode.children].filter(c=>c.tagName==e.tagName);if(sib.length>1)t+=`:nth-of-type(${sib.indexOf(e)+1})`;o.unshift(t);e=e.parentNode}return o.join(' > ')},[+q.body.x,+q.body.y])})}finally{await c.close()}}));
app.listen(PORT,()=>{console.log('Listening on',PORT);tick()});
