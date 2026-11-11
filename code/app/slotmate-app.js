// SlotMate v6 — мини-приложение в Телеграме + бот для уведомлений.
// Cloudflare Worker + база D1. Нужны: привязка D1 с именем DB и секрет BOT_TOKEN.
// Первый запуск: откройте адрес воркера с /setup на конце. Повторно /setup работает
// только с ключом: добавьте секрет SETUP_KEY и откройте /setup?key=<этот ключ>.
// Напоминания: в настройках воркера добавьте расписание (Cron) "0 * * * *".

const APP_HTML = "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>SlotMate</title>\n<script src=\"https://telegram.org/js/telegram-web-app.js\"></script>\n<style>\n:root{\n  --bg:#F2F2F7;--card:#FFFFFF;--text:#000000;--muted:#8A8A8E;--line:rgba(60,60,67,.29);--fill:rgba(118,118,128,.12);\n  --tint:#007AFF;--tint-soft:rgba(0,122,255,.12);--red:#FF3B30;--orange:#FF9500;--green:#34C759;--chev:#C4C4C7;\n  --scrim:rgba(0,0,0,.4);--bar:rgba(249,249,249,.9);--sheet:#F2F2F7;--scard:#FFFFFF;--seg-on:#FFFFFF;\n  --attn:var(--orange);--bad:var(--red);--ok:var(--green);\n}\n[data-theme=dark]{\n  --bg:#000000;--card:#1C1C1E;--text:#FFFFFF;--muted:#8D8D93;--line:rgba(84,84,88,.65);--fill:rgba(118,118,128,.24);\n  --tint:#0A84FF;--tint-soft:rgba(10,132,255,.2);--red:#FF453A;--orange:#FF9F0A;--green:#30D158;--chev:#5A5A5E;\n  --scrim:rgba(0,0,0,.6);--bar:rgba(22,22,24,.9);--sheet:#1C1C1E;--scard:#2C2C2E;--seg-on:#636366;\n}\n*{box-sizing:border-box}\nhtml,body{background:var(--bg)}\nbody{margin:0;color:var(--text);font-family:-apple-system,\"SF Pro Text\",system-ui,\"Segoe UI\",Roboto,sans-serif;font-size:17px;line-height:1.3;letter-spacing:-.01em;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}\nbutton{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0;letter-spacing:inherit}\n.wrap{padding:8px 16px 124px;max-width:640px;margin:0 auto}\n.head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:6px 0 14px}\nh1{font-size:34px;line-height:41px;margin:0;font-weight:700;letter-spacing:.01em}\n.sub{color:var(--muted);font-size:15px}\n.icon{width:44px;height:44px;flex-shrink:0;border-radius:22px;display:flex;align-items:center;justify-content:center;color:var(--tint);font-size:28px;font-weight:400}\n.icon:active{opacity:.5}\n.seg{display:flex;background:var(--fill);border-radius:9px;padding:2px;margin-bottom:12px;gap:0}\n.seg button{flex:1;min-height:32px;border-radius:7px;font-size:14px;font-weight:500;color:var(--text);display:flex;align-items:center;justify-content:center;gap:6px}\n.seg button[aria-selected=true]{background:var(--seg-on);font-weight:600;box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04)}\n.tabs{margin-bottom:20px}\n.tabs button{min-height:36px}\n.badge{display:inline-block;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--red);color:#fff;font-size:12px;font-weight:600;line-height:18px;text-align:center;letter-spacing:0}\n.weeknav{display:flex;align-items:center;gap:2px;margin:0 -8px 4px}\n.weeknav b{font-size:17px;font-weight:600;flex:1;text-align:center}\n.textbtn{min-height:44px;padding:0 8px;font-size:17px;color:var(--tint)}\n.group{background:var(--card);border-radius:12px;overflow:hidden}\n.sheet .group{background:var(--scard)}\n.day{margin-top:22px}\n.dayh,.sect{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13px;font-weight:400;color:var(--muted);text-transform:uppercase;letter-spacing:.02em;padding:0 16px 7px}\n.dayh .today{color:var(--tint);font-weight:600}\n.sect{margin-top:28px}\n.sect.hl{display:flex;justify-content:space-between;align-items:flex-end}\n.sect.hl .textbtn{min-height:0;padding:0;font-size:15px;text-transform:none;letter-spacing:0}\n.sect.tog{width:100%;min-height:36px;margin-top:22px;align-items:flex-end}\n.sect.tog span:last-child{color:var(--tint);text-transform:none;font-size:15px;letter-spacing:0}\n.free{font-size:17px;color:var(--muted);padding:11px 16px;position:relative}\n.busy{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 6px 6px 16px;min-height:52px;position:relative}\n.busy span{flex:1;min-width:120px;font-size:17px;color:var(--red)}\n.busy .mv{min-height:44px;padding:0 14px;border-radius:999px;background:var(--tint-soft);color:var(--tint);font-weight:600;font-size:15px}\n.busy .x{width:44px;height:44px;color:var(--muted);font-size:17px}\n.card{width:100%;padding:10px 16px;min-height:52px;display:flex;align-items:center;gap:14px;text-align:left;position:relative;background:transparent}\n.group>.card:active,.group>button.card:active{background:var(--fill)}\n.group>*+*:before{content:\"\";position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--line)}\n.group>.busy+*:before,.group>.free+*:before{left:16px}\n.group>button.card{padding-right:32px}\n.group>button.card:after{content:\"\";position:absolute;right:16px;top:50%;width:8px;height:8px;border-top:2px solid var(--chev);border-right:2px solid var(--chev);transform:translateY(-50%) rotate(45deg);border-radius:1px}\n.card.past{opacity:.4}\n.card .t{width:50px;flex-shrink:0;font-size:17px;font-variant-numeric:tabular-nums}\n.card .n{flex:1;min-width:0}\n.card .n b{display:block;font-size:17px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.card .n span{display:block;font-size:15px;color:var(--muted);margin-top:1px}\n.card .r{font-size:17px;color:var(--muted);white-space:nowrap}\n.chip{font-size:15px;white-space:nowrap;color:var(--muted)}\n.chip.act,.chip.attn{color:var(--orange);font-weight:600}\n.chip.bad{color:var(--red)}\n.chip.ok{color:var(--green)}\n.inbox{background:var(--card);border-radius:12px;padding:14px 16px 16px;margin-bottom:6px}\n.inbox h2{font-size:20px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}\n.item{padding:14px 0 0;margin-top:12px;border-top:.5px solid var(--line)}\n.item:first-of-type{border-top:0;margin-top:0}\n.item p{margin:0;font-size:17px;line-height:1.35}\n.item .why{font-size:15px;color:var(--muted);margin-top:3px}\n.item .row{margin-top:12px}\n.lead{background:var(--card);border-radius:12px;padding:16px;line-height:1.45;margin-bottom:12px}\n.big{background:var(--card);border-radius:12px;padding:16px;margin-bottom:14px}\n.big .top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px}\n.label{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.02em}\n.big .when{font-size:28px;font-weight:700;line-height:1.15;letter-spacing:.01em}\n.big .tm{font-size:17px;color:var(--muted);margin-top:4px}\n.big .bal{font-size:22px;font-weight:700}\n.note{margin:12px 0 0;font-size:17px;line-height:1.4}\n.warnbox,.infobox{margin-top:12px;padding:12px 14px;border-radius:12px;font-size:15px;line-height:1.4}\n.warnbox{background:rgba(255,59,48,.1);color:var(--text)}\n.infobox{background:var(--fill)}\n.paydue{background:rgba(255,149,0,.12);border-radius:12px;padding:14px 16px;margin-bottom:14px;font-size:16px;line-height:1.4}\n.paydue .row{margin-top:10px}\n.sheet .infobox{background:var(--scard)}\n.row{display:flex;gap:10px;margin-top:14px}\n.btn{flex:1;min-height:50px;border-radius:14px;background:var(--tint);color:#fff;font-weight:600;font-size:17px;padding:0 14px}\n.btn:active{opacity:.7}\n.btn.sm{min-height:44px;font-size:15px;border-radius:12px}\n.btn.sec{background:var(--tint-soft);color:var(--tint)}\n.fab.three .btn{flex:1 1 0;padding:0 6px;font-size:16px;white-space:nowrap}\n.fab.three .btn:first-child{flex:2 1 0}\n.btn.ghost{background:transparent;color:var(--tint);font-weight:400}\n.btn.mute{background:transparent;color:var(--tint);font-weight:400}\n.btn.danger{background:var(--red);color:#fff}\n.btn.dghost{background:transparent;color:var(--red);font-weight:400}\n.btn:disabled{opacity:.3;cursor:default}\n.fab{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(12px + env(safe-area-inset-bottom));background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-top:.5px solid var(--line);display:flex;gap:10px;max-width:640px;margin:0 auto}\n.sheet-bg{position:fixed;inset:0;background:var(--scrim);display:none;align-items:flex-end;z-index:9}\n.sheet-bg.on{display:flex}\n.sheet{background:var(--sheet);width:100%;max-width:640px;margin:0 auto;border-radius:12px 12px 0 0;padding:8px 16px calc(20px + env(safe-area-inset-bottom));max-height:92vh;overflow-y:auto}\n.sheet:before{content:\"\";display:block;width:36px;height:5px;border-radius:3px;background:var(--chev);margin:0 auto 14px}\n.sheet h3{margin:0 0 4px;font-size:22px;font-weight:700}\n.sheet .m{color:var(--muted);font-size:15px;line-height:1.4}\nlabel{display:block;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.02em;margin:20px 16px 7px}\ninput,select{width:100%;min-height:44px;border:0;border-radius:10px;padding:0 16px;font:inherit;font-size:17px;background:var(--card);color:var(--text);-webkit-appearance:none;appearance:none}\n.sheet input,.sheet select{background:var(--scard)}\ninput:focus,select:focus{outline:none;box-shadow:0 0 0 2px var(--tint) inset}\ninput[type=search],.search{background:var(--fill)!important;min-height:36px;border-radius:10px;padding:0 12px 0 34px;margin:0 0 10px;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238A8A8E' stroke-width='2.5' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E\")!important;background-repeat:no-repeat!important;background-position:11px center!important}\n.two{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end}\n.two label{margin-left:16px}\n.opts{display:flex;background:var(--fill);border-radius:9px;padding:2px}\n.opts button{flex:1;min-height:36px;padding:4px 8px;border-radius:7px;font-weight:500;font-size:14px;line-height:1.2}\n.opts button[aria-pressed=true]{background:var(--seg-on);font-weight:600;box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04)}\n.slots{display:flex;gap:8px;flex-wrap:wrap}\n.slots button{min-height:40px;padding:0 14px;border-radius:999px;background:var(--tint-soft);color:var(--tint);font-weight:500;font-size:15px}\n.slots button[aria-pressed=true]{background:var(--tint);color:#fff}\n.slots .wait{font-size:15px;color:var(--muted);padding:10px 0}\n.mvrow{background:var(--scard);border-radius:12px;padding:6px 16px 16px;margin-top:12px}\n.mvrow .hd{display:flex;align-items:center;gap:12px;min-height:50px;margin:0 0 8px;text-transform:none;letter-spacing:0;color:var(--text);font-size:17px}\n.mvrow .hd input{width:22px;height:22px;min-height:0;padding:0;flex-shrink:0;accent-color:var(--tint);-webkit-appearance:checkbox;appearance:auto;box-shadow:none}\n.mvrow label{margin-left:0}\n.sum{display:grid;grid-template-columns:1fr 1fr;background:var(--card);border-radius:12px;margin-bottom:8px}\n.sum div{padding:14px 16px}\n.sum div+div{border-left:.5px solid var(--line)}\n.sum b{display:block;font-size:28px;font-weight:700;letter-spacing:.01em}\n.sum span{font-size:13px;color:var(--muted)}\n.pay-sub{font-size:13px;color:var(--muted);padding:0 16px}\n.bar{height:6px;border-radius:3px;background:var(--fill);margin:12px 0 8px;overflow:hidden}\n.bar div{height:6px;background:var(--green);border-radius:3px}\n.link{word-break:break-all;background:var(--scard);padding:12px 16px;border-radius:10px;font-size:15px;margin-top:10px}\n.hint{font-size:13px;color:var(--muted);margin:7px 16px 0;min-height:16px}\n.hide{display:none!important}\n.demo{display:flex;align-items:center;gap:8px;background:var(--orange);color:#fff;border-radius:12px;padding:6px 6px 6px 14px;margin:4px 0 6px;font-size:15px;font-weight:600}\n.demo span{flex:1}\n.demo button{min-height:36px;padding:0 12px;border-radius:9px;background:rgba(255,255,255,.25);color:#fff;font-weight:600;font-size:15px}\n.toast{position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));width:max-content;max-width:calc(100% - 32px);background:rgba(30,30,30,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);color:#fff;padding:6px 6px 6px 18px;border-radius:999px;font-size:15px;display:flex;align-items:center;gap:6px;min-height:48px;opacity:0;transform:translate(-50%,10px);transition:opacity .25s,transform .25s;z-index:20;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.2)}\n.toast.top{bottom:auto;top:calc(10px + env(safe-area-inset-top));transform:translate(-50%,-10px)}\n.toast.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}\n.toast span{flex:1;padding-right:8px}\n.toast button{min-height:36px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;font-weight:600;padding:0 14px}\n</style>\n</head>\n<body>\n<div class=\"wrap\" id=\"app\"><div class=\"lead\">Загрузка…</div></div>\n<div class=\"fab\" id=\"fab\" style=\"display:none\"></div>\n<div class=\"sheet-bg\" id=\"sheetbg\"><div class=\"sheet\" id=\"sheet\" role=\"dialog\" aria-modal=\"true\"></div></div>\n<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\"><span id=\"toastText\"></span><button id=\"toastBtn\" style=\"display:none\"></button></div>\n<script>\n(function(){\nvar tg=window.Telegram&&window.Telegram.WebApp;\nvar initData=tg?tg.initData:'';\nfunction theme(){var dark=tg&&tg.colorScheme==='dark';document.documentElement.setAttribute('data-theme',dark?'dark':'light');\n  try{if(tg&&tg.isVersionAtLeast&&tg.isVersionAtLeast('6.1')){var c=dark?'#000000':'#F2F2F7';tg.setHeaderColor(c);tg.setBackgroundColor(c);}}catch(e){}}\ntheme();\nif(tg){tg.ready();tg.expand();if(tg.onEvent)tg.onEvent('themeChanged',theme);}\nvar BB=tg&&tg.BackButton&&tg.isVersionAtLeast&&tg.isVersionAtLeast('6.1')?tg.BackButton:null;\n\nvar Q=new URLSearchParams(location.search);\nvar S={data:null,mode:'',tab:Q.get('tab')==='pay'?'students':(Q.get('tab')||'week'),weekStart:null,deep:true};\nvar WD=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];\nvar WDF=['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];\nvar MON=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];\nvar MONN=['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];\nvar GEAR='<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/></svg>';\n\nfunction esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}\nfunction pad(n){return (n<10?'0':'')+n;}\nfunction plural(n,a,b,c){var x=Math.abs(n)%100,y=x%10;if(x>10&&x<20)return c;if(y>1&&y<5)return b;if(y===1)return a;return c;}\nfunction lw(n){return n+' '+plural(n,'урок','урока','уроков');}\nfunction today(){return S.data.today;}\nfunction addDays(ymd,n){var p=ymd.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10);}\nfunction wd(ymd){var p=ymd.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2])).getUTCDay();}\nfunction monday(ymd){var w=wd(ymd);return addDays(ymd,w===0?-6:1-w);}\nfunction dm(ymd){var p=ymd.split('-').map(Number);return p[2]+' '+MON[p[1]-1];}\nfunction fmtDate(ymd){return WD[wd(ymd)]+', '+dm(ymd);}\nfunction fmt(ts){return fmtDate(ts.slice(0,10))+', '+ts.slice(11,16);}\nfunction fmtShort(ts){var y=ts.slice(0,10),p=y.split('-').map(Number);return WD[wd(y)]+' '+p[2]+'.'+pad(p[1])+' '+ts.slice(11,16);}\nfunction endTime(ts,dur){var p=ts.slice(11,16).split(':').map(Number),m=p[0]*60+p[1]+(dur||60);return pad(Math.floor(m/60)%24)+':'+pad(m%60);}\nfunction first(name){return String(name||'').split(' ')[0];}\nfunction L(id){return S.data.lessons.filter(function(x){return x.id===id;})[0];}\nfunction stu(id){return S.data.students.filter(function(x){return x.id===id;})[0];}\nfunction isDue(s){return !!s.due;}\nfunction balText(left,paid,used){if(!paid&&!used)return 'оплат пока нет';if(left>0)return 'осталось '+lw(left);if(left===0)return 'оплаченные уроки закончились';return 'долг: '+lw(-left);}\nfunction balShort(s){if(!s.paid&&!s.used)return '<span class=\"r\"'+(s.due?' style=\"color:var(--attn)\"':'')+'>нет оплат</span>';if(s.left>0)return '<span class=\"r\">осталось '+s.left+'</span>';if(s.left===0)return '<span class=\"r\" style=\"color:var(--attn)\">0 уроков</span>';return '<span class=\"r\" style=\"color:var(--bad)\">долг '+(-s.left)+'</span>';}\nfunction seriesLabel(l,cancel){return l.series_auto?(cancel?'Этот и все следующие (повтор остановится)':'Этот и все следующие'):'Этот и все следующие (до '+dm(l.series_end.slice(0,10))+', всего '+lw(l.later+1)+')';}\nfunction packText(set){return lw(set.pack_size)+(set.pack_price?' · '+set.pack_price+' zł':'');}\n// Сумма за n уроков по цене абонемента: 4 за 600 → 1 урок 150, 8 уроков 1200.\nfunction priceFor(set,n){if(!set.pack_price||!(n>=1))return 0;var k=n/set.pack_size;return k===Math.floor(k)?set.pack_price*k:Math.round(n*set.pack_price/set.pack_size);}\nfunction payPresets(set){var p=set.pack_size||4,a=p===1?[1,4,8]:[1,p,2*p];return a.filter(function(x,i){return a.indexOf(x)===i;});}\nfunction claimText(c){return lw(c.lessons)+(c.amount?' · '+c.amount+' zł':'');}\n\nvar toastT;\nfunction toast(m,label,fn){var t=document.getElementById('toast'),b=document.getElementById('toastBtn');document.getElementById('toastText').textContent=m;\n  t.classList.toggle('top',document.getElementById('sheetbg').classList.contains('on'));\n  if(label){b.style.display='';b.textContent=label;b.onclick=function(){t.classList.remove('on');fn();};}else{b.style.display='none';b.onclick=null;}\n  t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('on');},label?6000:3000);}\nfunction api(path,body){\n  return fetch('/api/'+path,{method:'POST',headers:S.demo?{'content-type':'application/json','x-init-data':initData,'x-demo':'1'}:{'content-type':'application/json','x-init-data':initData},body:JSON.stringify(body||{})})\n  .then(function(r){return r.json().catch(function(){return {error:'Нет связи с сервером. Попробуйте ещё раз.'};});},function(){return {error:'Нет связи. Проверьте интернет и попробуйте ещё раз.'};})\n  .then(function(j){if(j.error){toast(j.error);throw new Error(j.error);}return j;});\n}\nfunction load(){return api('me',{week:S.weekStart}).then(function(d){S.data=d;if(!S.mode)S.mode=d.is_teacher?'t':'s';if(!S.weekStart)S.weekStart=monday(d.today);render();if(S.deep){S.deep=false;deepLink();}});}\nfunction deepLink(){\n  var lid=+Q.get('l'),sid=+Q.get('s');\n  if(lid){var l=L(lid);if(l){if(l.is_teaching&&S.data.is_teacher)S.mode='t';else if(l.is_mine)S.mode='s';render();A.lesson(lid);}else toast('Урок не найден — возможно, он уже отменён или прошёл');}\n  else if(sid&&S.data.is_teacher){S.mode='t';S.tab='students';render();if(Q.get('pay')&&stu(sid))A.pay(sid);else if(Q.get('add')&&stu(sid))A.addLesson(sid);else A.student(sid);}\n}\nfunction act(path,body,okMsg,back){\n  return api(path,body).then(function(r){\n    if(r.conflict){conflictSheet(r.conflict,path,body,okMsg,back);return r;}\n    closeSheet();if(okMsg)toast(okMsg);load();return r;\n  }).catch(function(){});\n}\nfunction conflictSheet(text,path,body,okMsg,back){\n  S.back=back;\n  var canForce=path==='lesson/add';\n  if(canForce)S.retry=function(){act(path,Object.assign({},body,{force:true}),okMsg);};\n  openSheet('<h3>Это время занято</h3><div class=\"warnbox\" style=\"white-space:pre-line\">'+esc(text)+'</div><div class=\"row\"><button class=\"btn\" onclick=\"A.back()\">Выбрать другое время</button></div>'+(canForce?'<div class=\"row\" style=\"margin-top:4px\"><button class=\"btn mute\" onclick=\"A.retry()\">Добавить с наложением</button></div><div class=\"hint\">Урок встанет на это время, даже если оно занято: в эти часы у вас будет два дела сразу.</div>':''));\n}\n\n// ---------- статусы ----------\nfunction lessonState(l,asT){\n  if(l.status==='late')return {chip:'<span class=\"chip wait\">поздняя отмена</span>',note:'отменён поздно · списывается'};\n  if(asT&&l.past&&(l.check_needed||l.status==='pending'||l.reminder_answer==='no'))return {chip:'<span class=\"chip attn\">решите</span>',note:'состоялся ли урок?'};\n  if(l.status==='pending'&&l.proposed_start){\n    var onMe=(l.proposed_by==='t')!==asT;\n    return {chip:onMe?'<span class=\"chip act\">ответьте</span>':'<span class=\"chip wait\">ждём ответа</span>',note:'перенос на '+fmtShort(l.proposed_start)+(l.proposed_scope==='series'?' и далее':''),onMe:onMe};\n  }\n  if(l.reminder_answer==='no'&&!l.past)return {chip:'<span class=\"chip bad\">'+(asT?'не придёт':'вы не придёте')+'</span>',note:asT?'ученик ответил «не смогу»':'вы ответили «не смогу»'};\n  if(l.clash)return asT?{chip:'<span class=\"chip bad\">совпадает</span>',note:'совпадает: '+l.clash}:{chip:'',note:'у учителя: '+l.clash};\n  if(asT&&l.pay_due&&!l.past)return {chip:'<span class=\"chip attn\">оплата</span>',note:'ждём оплату'};\n  return {chip:'',note:''};\n}\nfunction inboxItems(){\n  var d=S.data;\n  var fut=d.lessons.filter(function(l){return l.is_teaching&&!l.past&&((l.status==='pending'&&l.proposed_by==='s')||(l.status==='scheduled'&&l.reminder_answer==='no'));});\n  return {fut:fut,past:d.to_check||[],claims:d.claims||[]};\n}\nfunction inboxCount(){var x=inboxItems();return x.fut.length+x.past.length+x.claims.length;}\n\n// ---------- отрисовка ----------\nfunction render(){\n  var d=S.data,app=document.getElementById('app'),fab=document.getElementById('fab'),h='';\n  if(!d.is_teacher&&!d.is_student){\n    h+='<div class=\"head\"><div><h1>SlotMate</h1><div class=\"sub\">расписание уроков без путаницы</div></div></div><div class=\"lead\">Привет, '+esc(d.name)+'!<br><br>';\n    if(d.is_admin)h+='Вы владелец бота. Чтобы подключить учителя, отправьте ему ссылку-приглашение.<div class=\"row\"><button class=\"btn\" onclick=\"A.teacherInvite()\">Ссылка для учителя</button></div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.demo()\">Посмотреть кабинет учителя (демо)</button></div>';\n    else h+='Чтобы записаться, попросите у учителя ссылку-приглашение и откройте её в Телеграме.';\n    app.innerHTML=h+'</div>';fab.style.display='none';return;\n  }\n  var asT=S.mode==='t';\n  if(S.demo)h+='<div class=\"demo\"><span>Демо · никому не отправляется</span><button onclick=\"A.demoReset()\">Сбросить</button><button onclick=\"A.demoExit()\">Выйти</button></div>';\n  var title=asT?(S.tab==='week'?'Расписание':'Ученики'):'Мои уроки';\n  h+='<div class=\"head\"><div><h1>'+title+'</h1><div class=\"sub\">'+(asT?esc(d.name)+' · учитель':studentSub())+'</div></div><div style=\"display:flex\">'+(asT?'':'<button class=\"icon\" aria-label=\"Как это работает\" onclick=\"A.help()\">?</button>')+'<button class=\"icon\" aria-label=\"Настройки\" onclick=\"A.settings()\">'+GEAR+'</button></div></div>';\n  if(d.is_teacher&&d.is_student&&!S.demo)h+='<div class=\"seg\" role=\"tablist\"><button role=\"tab\" aria-selected=\"'+asT+'\" onclick=\"A.mode(\\'t\\')\">Я учитель</button><button role=\"tab\" aria-selected=\"'+!asT+'\" onclick=\"A.mode(\\'s\\')\">Я ученик</button></div>';\n  if(asT){\n    var nIn=inboxCount();\n    var due=d.students.filter(isDue).length;\n    h+='<div class=\"seg tabs\" role=\"tablist\"><button role=\"tab\" aria-selected=\"'+(S.tab==='week')+'\" onclick=\"A.tab(\\'week\\')\">Расписание'+(nIn?'<span class=\"badge\">'+nIn+'</span>':'')+'</button><button role=\"tab\" aria-selected=\"'+(S.tab!=='week')+'\" onclick=\"A.tab(\\'students\\')\">Ученики'+(due?'<span class=\"badge\">'+due+'</span>':'')+'</button></div>';\n    h+=S.tab==='week'?renderInbox()+renderWeek():renderStudents();\n    fab.style.display='flex';\n    // Внизу: слева всегда широкая «Получил оплату» (самое частое), справа — действия этой вкладки:\n    // «Расписание» — «+ Урок» и «Я занят», «Ученики» — «+ Ученик». Пока учеников нет — только «Пригласить ученика».\n    fab.classList.toggle('three',!!d.students.length);\n    if(!d.students.length)fab.innerHTML='<button class=\"btn\" onclick=\"A.invite()\">Пригласить ученика</button>';\n    else fab.innerHTML='<button class=\"btn\" onclick=\"A.payStart()\">Получил оплату</button>'+(S.tab==='week'?'<button class=\"btn sec\" onclick=\"A.addLesson()\">+ Урок</button><button class=\"btn sec\" onclick=\"A.busy()\">Я занят</button>':'<button class=\"btn sec\" onclick=\"A.invite()\">+ Ученик</button>');\n  }else{\n    h+=renderStudent();\n    fab.style.display='none';\n  }\n  app.innerHTML=h;\n}\nfunction renderInbox(){\n  var x=inboxItems(),n=inboxCount();if(!n)return '';\n  var h='<div class=\"inbox\"><h2>Нужно ваше решение <span class=\"badge\">'+n+'</span></h2>';\n  x.fut.forEach(function(l){\n    if(l.status==='pending')h+='<div class=\"item\"><p><b>'+esc(l.student_name)+'</b> просит перенести '+fmtShort(l.starts_at)+' → <b>'+fmtShort(l.proposed_start)+'</b>'+(l.proposed_scope==='series'?' и все следующие':'')+'</p><div class=\"row\"><button class=\"btn sm\" onclick=\"A.answer('+l.id+',true)\">Подтвердить</button><button class=\"btn sm sec\" onclick=\"A.answer('+l.id+',false)\">Не подходит</button></div></div>';\n    else h+='<div class=\"item\"><p><b>'+esc(l.student_name)+'</b> не сможет прийти: '+fmtShort(l.starts_at)+'</p><div class=\"row\"><button class=\"btn sm sec\" onclick=\"A.noCharge('+l.id+')\">Отменить без списания</button><button class=\"btn sm\" onclick=\"A.lesson('+l.id+')\">Перенести</button></div></div>';\n  });\n  x.claims.forEach(function(c){\n    h+='<div class=\"item\"><p><b>'+esc(c.name)+'</b> пишет, что оплатил: <b>'+claimText(c)+'</b></p><div class=\"why\">Абонемент засчитается, когда вы подтвердите.</div><div class=\"row\"><button class=\"btn sm\" onclick=\"A.claimAnswer('+c.id+',true)\">Получил</button><button class=\"btn sm sec\" onclick=\"A.claimAnswer('+c.id+',false)\">Не получал</button></div></div>';\n  });\n  x.past.forEach(function(c){\n    h+='<div class=\"item\"><p><b>'+esc(c.student_name)+'</b> · '+fmtShort(c.starts_at)+' — урок состоялся?</p><div class=\"why\">'+(c.why==='no'?'Ученик отвечал «не смогу».':'Перенос так и не подтвердили.')+' Пока вы не ответите, урок не списывается.</div><div class=\"row\"><button class=\"btn sm\" onclick=\"A.resolve('+c.id+',true)\">Да, списать</button><button class=\"btn sm sec\" onclick=\"A.resolve('+c.id+',false)\">Не списывать</button></div></div>';\n  });\n  return h+'</div>';\n}\nfunction weekTitle(ws){var we=addDays(ws,6),a=ws.split('-').map(Number),b=we.split('-').map(Number);\n  return a[1]===b[1]?a[2]+'–'+b[2]+' '+MON[a[1]-1]:a[2]+' '+MON[a[1]-1].slice(0,3)+' – '+b[2]+' '+MON[b[1]-1].slice(0,3);}\nfunction busyAffected(b){var f=b.from_t.split(':').map(Number),t=b.to_t.split(':').map(Number),fm=f[0]*60+f[1],tm=t[0]*60+t[1];\n  return S.data.lessons.filter(function(l){if(!l.is_teaching||l.past||l.status!=='scheduled'||l.starts_at.slice(0,10)!==b.day)return false;var p=l.starts_at.slice(11,16).split(':').map(Number),x=p[0]*60+p[1];return x<tm&&fm<x+(l.duration||60);});}\nfunction renderWeek(){\n  var d=S.data,ws=S.weekStart,h='';\n  var cur=monday(today())===ws;\n  h+='<div class=\"weeknav\"><button class=\"icon\" aria-label=\"Прошлая неделя\" onclick=\"A.week(-1)\">‹</button><b>'+weekTitle(ws)+'</b>'+(cur?'':'<button class=\"textbtn\" onclick=\"A.week(0)\">Сегодня</button>')+'<button class=\"icon\" aria-label=\"Следующая неделя\" onclick=\"A.week(1)\">›</button></div>';\n  var mine=d.lessons.filter(function(l){return l.is_teaching;}),shown=0;\n  for(var i=0;i<7;i++){\n    var ymd=addDays(ws,i);\n    var ls=mine.filter(function(l){return l.starts_at.slice(0,10)===ymd;});\n    var bs=d.busy.filter(function(b){return b.day===ymd;});\n    if(!ls.length&&!bs.length&&ymd!==today())continue;\n    shown++;\n    h+='<div class=\"day\"><div class=\"dayh\"><span>'+WDF[wd(ymd)]+', '+dm(ymd)+'</span>'+(ymd===today()?'<span class=\"today\">сегодня</span>':'')+'</div><div class=\"group\">';\n    bs.forEach(function(b){var span=b.from_t==='00:00'&&b.to_t==='23:59'?'весь день':b.from_t+'–'+b.to_t,aff=busyAffected(b);\n      h+='<div class=\"busy\"><span>'+esc(b.note||'Занят')+' · '+span+'</span>'+(aff.length?'<button class=\"mv\" onclick=\"A.moveBusy('+b.id+')\">Перенести уроки ('+aff.length+')</button>':'')+'<button class=\"x\" aria-label=\"Убрать отметку «'+esc(b.note||'Занят')+'»\" onclick=\"A.unbusy('+b.id+')\">✕</button></div>';});\n    if(!ls.length&&!bs.length)h+='<div class=\"free\">свободно</div>';\n    ls.forEach(function(l){var st=lessonState(l,true);\n      h+='<button class=\"card'+(l.past||l.status==='late'?' past':'')+'\" onclick=\"A.lesson('+l.id+')\"><span class=\"t\">'+l.starts_at.slice(11,16)+'</span><span class=\"n\"><b>'+esc(l.student_name)+'</b>'+(st.note?'<span>'+esc(st.note)+'</span>':'')+'</span>'+st.chip+'</button>';});\n    h+='</div></div>';\n  }\n  if(!shown&&d.students.length)h+='<div class=\"lead\" style=\"margin-top:16px\">На этой неделе уроков нет.</div>';\n  if(!d.students.length)h+='<div class=\"lead\" style=\"margin-top:16px\">Пока нет учеников. Откройте вкладку «Ученики» и отправьте ссылку-приглашение.</div>';\n  return h;\n}\nfunction searchBox(id,ph){return '<input class=\"search\" type=\"search\" id=\"'+id+'\" placeholder=\"'+ph+'\" oninput=\"A.filter(this)\" autocomplete=\"off\">';}\n// Ученики и оплаты — один список: сверху сводка, дальше «Ждём оплату», «Остался 1 урок», остальные.\nfunction stuRow(s){return '<button class=\"card\" data-n=\"'+esc(s.name.toLowerCase())+'\" onclick=\"A.student('+s.id+')\"><span class=\"n\"><b>'+esc(s.name)+'</b><span>'+(s.next?'следующий: '+fmtShort(s.next):'уроков впереди нет')+'</span></span>'+balShort(s)+'</button>';}\n// Кто, скорее всего, сейчас заплатил: урок сегодня и ждём оплату (ближе ко «сейчас» — выше) → ждём оплату → урок сегодня → остальные.\nfunction payOrder(){var d=S.data,now=Date.parse(String(d.now).replace(' ','T')),\n  dist=function(s){return Math.abs(Date.parse(s.today_at.replace(' ','T'))-now);},\n  g=function(s){return s.today_at&&isDue(s)?0:isDue(s)?1:s.today_at?2:3;};\n  return d.students.slice().sort(function(a,b){var x=g(a)-g(b);if(x)return x;\n    if(g(a)!==1&&g(a)!==3)return dist(a)-dist(b);\n    if(g(a)===1){var p=a.next||'9',q=b.next||'9';if(p!==q)return p<q?-1:1;}\n    return a.name.localeCompare(b.name,'ru');});}\nfunction payWhen(s){return s.today_at?'урок сегодня в '+s.today_at.slice(11,16):s.next?'следующий: '+fmtShort(s.next):'уроков впереди нет';}\nfunction payRow(s){return '<button class=\"card\" data-n=\"'+esc(s.name.toLowerCase())+'\" onclick=\"A.pay('+s.id+',true)\"><span class=\"n\"><b>'+esc(s.name)+'</b><span>'+payWhen(s)+'</span></span>'+balShort(s)+'</button>';}\nfunction renderStudents(){\n  var d=S.data,set=d.settings,m=d.month,h='';\n  if(!d.students.length)return '<div class=\"lead\">Пока нет учеников.<br><br>Нажмите «Пригласить ученика» и отправьте ссылку в Телеграме. Кто откроет ссылку, появится здесь, а вам придёт сообщение.</div>';\n  if(d.uses_pay){var mon=MONN[Number(today().slice(5,7))-1];\n    h+='<div class=\"sum\"><div><b>'+m.got+' zł</b><span>получено в '+mon+'</span></div><div><b'+(m.due_count?' style=\"color:var(--attn)\"':'')+'>'+(set.pack_price?m.due_sum+' zł':m.due_count)+'</b><span>ждём от '+m.due_count+' '+plural(m.due_count,'ученика','учеников','учеников')+'</span></div></div>';\n    h+='<div class=\"pay-sub\">Абонемент: '+lw(set.pack_size)+(set.pack_price?' · '+set.pack_price+' zł':' · <button class=\"textbtn\" style=\"padding:0;min-height:0;text-decoration:underline\" onclick=\"A.settings()\">указать цену</button>')+'. Урок списывается, когда прошёл.</div>';}\n  if(d.students.length>8)h+='<div style=\"margin-top:14px\">'+searchBox('sq','Найти ученика')+'</div>';\n  if(!d.uses_pay)return h+'<div class=\"grp group\" style=\"margin-top:14px\">'+d.students.map(stuRow).join('')+'</div>';\n  var due=[],soon=[],rest=[];\n  d.students.forEach(function(s){if(isDue(s))due.push(s);else if(s.left===1)soon.push(s);else rest.push(s);});\n  due.sort(function(a,b){return a.left-b.left;});\n  if(due.length)h+='<div class=\"grp\"><div class=\"sect hl\"><span>Ждём оплату · '+due.length+'</span><button class=\"textbtn\" onclick=\"A.remindAll()\">Напомнить всем</button></div><div class=\"group\">'+due.map(stuRow).join('')+'</div></div>';\n  if(soon.length)h+='<div class=\"grp\"><div class=\"sect\">Остался 1 урок · '+soon.length+'</div><div class=\"group\">'+soon.map(stuRow).join('')+'</div></div>';\n  if(rest.length)h+='<div class=\"grp\"><div class=\"sect\">'+(due.length||soon.length?'Остальные':'Все ученики')+' · '+rest.length+'</div><div class=\"group\">'+rest.map(stuRow).join('')+'</div></div>';\n  var ps=d.payments||[];\n  if(ps.length)h+='<div class=\"row\" style=\"margin-top:8px\"><button class=\"btn mute\" onclick=\"A.payHistory()\">Все оплаты ('+ps.length+')</button></div>';\n  return h;\n}\nfunction payHist(p){var dt=String(p.created_at).slice(0,10);return '<div class=\"card\"><span class=\"n\"><b>'+esc(p.name)+' · '+lw(p.lessons)+(p.amount?' · '+p.amount+' zł':'')+'</b><span>'+(p.kind==='initial'?'начальный остаток · ':'')+(/^\\d{4}-\\d\\d-\\d\\d$/.test(dt)?dm(dt):'')+'</span></span><button class=\"btn dghost sm\" style=\"flex:0;padding:0 4px\" onclick=\"A.payUndoAsk('+p.id+')\">Отменить</button></div>';}\n// Экран ученика: когда урок и всё ли оплачено — с одного взгляда. Одна кнопка: «Не смогу прийти».\nfunction subOf(l){return S.data.my_subs.filter(function(x){return x.id===l.student_id;})[0];}\nfunction subUses(s){return !!(s&&(s.paid||s.used||s.pack_price));}\nfunction payMark(l){var s=subOf(l);if(!subUses(s))return '';return l.paid_ok?'<span style=\"color:var(--ok)\">оплачен ✓</span>':'<span style=\"color:var(--attn)\">не оплачен</span>';}\nfunction studentSub(){var d=S.data,subs=d.my_subs.filter(subUses);\n  if(subs.length!==1)return esc(d.name)+' · ученик';var s=subs[0];\n  if(s.left>0)return esc(s.teacher_name)+' · '+(s.paid_until?'оплачено до '+dm(s.paid_until.slice(0,10)):'осталось '+lw(s.left));\n  return esc(s.teacher_name)+' · ученик';}\nfunction renderStudent(){\n  var d=S.data,h='';\n  var mine=d.lessons.filter(function(l){return l.is_mine&&!l.past&&l.status!=='late';});\n  var manyT=d.my_subs.length>1;\n  // Пора платить — блок сверху (пока всё оплачено, его нет).\n  d.my_subs.forEach(function(s){if(!subUses(s)||s.left>0)return;\n    var hasNext=mine.some(function(l){return l.student_id===s.id;});if(!s.paid&&!s.used&&!hasNext)return;\n    var what='<b>'+(s.left<0?'Долг: '+lw(-s.left):!s.paid&&!s.used?'Абонемент ещё не оплачен':'Оплаченные уроки закончились')+'</b>'+(s.pack_price?'<div style=\"font-size:15px;color:var(--muted);margin-top:2px\">Абонемент: '+packText(s)+'</div>':'');\n    if(s.claim)h+='<div class=\"infobox\" style=\"margin:0 0 14px\">Вы отметили оплату: '+claimText(s.claim)+'. Ждём, когда '+(manyT?esc(s.teacher_name):'учитель')+' подтвердит.</div>';\n    else h+='<div class=\"paydue\"><div>'+(manyT?esc(s.teacher_name)+' · ':'')+what+'</div><div class=\"row\"><button class=\"btn\" onclick=\"A.paySoon()\">Оплатить</button></div></div>';});\n  var next=mine[0];\n  if(!next)h+='<div class=\"lead\">Ближайших уроков нет. Когда учитель назначит урок, он появится здесь, а в Телеграм придёт сообщение.</div>';\n  else{\n    var st=lessonState(next,false),pm=payMark(next);\n    h+='<div class=\"big\"><div class=\"top\"><span class=\"label\">Следующий урок</span>'+(next.status==='pending'||next.reminder_answer==='no'?st.chip:'')+'</div><div class=\"when\">'+fmtDate(next.starts_at.slice(0,10))+' · '+next.starts_at.slice(11,16)+'</div><div class=\"tm\">до '+endTime(next.starts_at,next.duration)+(manyT?' · '+esc(next.teacher_name):'')+(pm?' · '+pm:'')+'</div>';\n    if(next.status==='pending'){\n      if(st.onMe)h+='<p class=\"note\">Учитель предлагает перенести на <b>'+fmt(next.proposed_start)+'</b>'+(next.proposed_scope==='series'?' — и все следующие уроки тоже':'')+'. Пока вы не ответили, урок остаётся на старом времени.</p><div class=\"row\"><button class=\"btn\" onclick=\"A.answer('+next.id+',true)\">Подтвердить</button><button class=\"btn sec\" onclick=\"A.answer('+next.id+',false)\">Не подходит</button></div>';\n      else h+='<p class=\"note\">Вы предложили <b>'+fmt(next.proposed_start)+'</b>. Ждём ответа учителя — пока урок остаётся на старом времени.</p><div class=\"row\"><button class=\"btn sec\" onclick=\"A.withdraw('+next.id+')\">Отозвать предложение</button></div>';\n    }else{\n      if(next.reminder_answer==='no')h+='<p class=\"note\">Вы ответили «не смогу». Учитель решит, как быть с уроком.</p><div class=\"row\"><button class=\"btn sec\" onclick=\"A.lesson('+next.id+')\">Предложить другое время</button></div>';\n      else{if(next.clash)h+='<p class=\"note\" style=\"font-size:15px;color:var(--muted)\">У учителя в это время: '+esc(next.clash)+'. Возможно, он предложит другое время.</p>';\n        h+='<div class=\"row\"><button class=\"btn sec\" onclick=\"A.lesson('+next.id+')\">Не смогу прийти</button></div>';}\n    }\n    h+='</div>';\n  }\n  if(mine.length>1){h+='<div class=\"sect\">Дальше</div><div class=\"group\">';mine.slice(1,9).forEach(function(l){var s2=lessonState(l,false),pm2=payMark(l);\n    var sb=subOf(l),right=s2.chip||(l.paid_ok||(sb&&sb.left>0)?pm2:'');\n    h+='<button class=\"card\" onclick=\"A.lesson('+l.id+')\"><span class=\"t\">'+l.starts_at.slice(11,16)+'</span><span class=\"n\"><b>'+fmtDate(l.starts_at.slice(0,10))+'</b>'+(s2.note||manyT?'<span>'+esc(s2.note||l.teacher_name)+'</span>':'')+'</span>'+right+'</button>';});h+='</div>';}\n  return h;\n}\n\n// ---------- шторки ----------\nfunction openSheet(html){var t=document.getElementById('toast');if(t.classList.contains('on'))t.classList.add('top');document.getElementById('sheet').innerHTML=html;document.getElementById('sheetbg').classList.add('on');document.getElementById('sheet').scrollTop=0;if(BB)BB.show();}\nfunction closeSheet(){document.getElementById('sheetbg').classList.remove('on');if(BB)BB.hide();}\nif(BB)BB.onClick(closeSheet);\ndocument.getElementById('sheetbg').addEventListener('click',function(e){if(e.target.id==='sheetbg')closeSheet();});\nfunction dt(id,date,time,chk){var c=chk?' oninput=\"A.touch()\"':'';return '<div class=\"two\"><div><label for=\"'+id+'d\">Дата</label><input type=\"date\" id=\"'+id+'d\" value=\"'+date+'\" min=\"'+today()+'\"'+c+'></div><div><label for=\"'+id+'t\">Время</label><input type=\"time\" id=\"'+id+'t\" step=\"900\" value=\"'+time+'\"'+c+'></div></div>';}\nfunction readTs(id){var d=document.getElementById(id+'d').value,t=document.getElementById(id+'t').value;return d&&t?d+' '+t.slice(0,5):null;}\nfunction setTs(id,ts){document.getElementById(id+'d').value=ts.slice(0,10);document.getElementById(id+'t').value=ts.slice(11,16);}\nfunction opts(name,list,val){return '<div class=\"opts\" data-name=\"'+name+'\">'+list.map(function(o){return '<button type=\"button\" aria-pressed=\"'+(String(o[0])===String(val))+'\" data-v=\"'+o[0]+'\" onclick=\"A.pick(this)\">'+o[1]+'</button>';}).join('')+'</div>';}\nfunction optVal(name){var b=document.querySelector('.opts[data-name=\"'+name+'\"] [aria-pressed=true]');return b?b.getAttribute('data-v'):null;}\nfunction slotsBox(id){return '<div class=\"slots\" id=\"'+id+'\"><span class=\"wait\">Ищу свободное время…</span></div>';}\nfunction fillSlots(boxId,target,list,onPick){var box=document.getElementById(boxId);if(!box)return;\n  if(!list.length){box.innerHTML='<span class=\"wait\">Свободных окон рядом не нашлось — выберите время вручную.</span>';return;}\n  box.innerHTML=list.map(function(ts){return '<button type=\"button\" aria-pressed=\"false\" data-ts=\"'+ts+'\">'+fmtShort(ts)+'</button>';}).join('');\n  Array.prototype.forEach.call(box.children,function(b){b.onclick=function(){Array.prototype.forEach.call(box.children,function(x){x.setAttribute('aria-pressed','false');});b.setAttribute('aria-pressed','true');setTs(target,b.getAttribute('data-ts'));if(onPick)onPick();};});}\nfunction seriesSoon(l){return l.is_teaching&&l.series_id&&l.series_end&&l.series_end.slice(0,10)<=addDays(today(),28);}\n\nvar A={\n  mode:function(m){S.mode=m;render();},\n  tab:function(t){S.tab=t;render();window.scrollTo(0,0);},\n  week:function(n){S.weekStart=n===0?monday(today()):addDays(S.weekStart,7*n);load();},\n  pick:function(b){Array.prototype.forEach.call(b.parentNode.children,function(c){c.setAttribute('aria-pressed','false');});b.setAttribute('aria-pressed','true');var nm=b.parentNode.getAttribute('data-name'),x;\n    if(nm==='rep'&&(x=document.getElementById('weeksRow')))x.style.display=b.getAttribute('data-v')==='1'?'none':'';\n    if(nm==='allday'&&(x=document.getElementById('bhrs')))x.style.display=b.getAttribute('data-v')==='1'?'none':'';\n    A.chk();},\n  filter:function(inp){var q=inp.value.trim().toLowerCase();var root=inp.closest('.sheet')||document.getElementById('app');\n    Array.prototype.forEach.call(root.querySelectorAll('.card[data-n]'),function(c){c.style.display=!q||c.getAttribute('data-n').indexOf(q)>=0?'':'none';});\n    Array.prototype.forEach.call(root.querySelectorAll('.grp'),function(g){var any=Array.prototype.some.call(g.querySelectorAll('.card[data-n]'),function(c){return c.style.display!=='none';});g.style.display=any?'':'none';});},\n  back:function(){if(S.back)S.back();else closeSheet();},\n  retry:function(){S.retry&&S.retry();},\n  touch:function(){S.touched=true;A.chk();},\n  chk:function(){var b=document.getElementById('sendBtn'),hint=document.getElementById('sendHint');if(!b||!S.cur)return;var ts=readTs('rs');\n    var bad=!ts?'Укажите дату и время':ts===S.cur.starts_at?'Это текущее время урока — выберите другое':ts<=S.data.now?'Это время уже прошло':'';\n    b.disabled=!!bad;if(hint)hint.textContent=S.touched?bad:'';},\n  showResched:function(){var r=document.getElementById('resched'),b=document.getElementById('reschedBtn');if(r)r.classList.remove('hide');if(b)b.classList.add('hide');},\n\n  lesson:function(id,afterNo){\n    var l=L(id);if(!l)return;var asT=S.mode==='t'&&l.is_teaching;S.cur=l;S.touched=false;\n    var who=asT?'Ученик: '+esc(l.student_name):'Учитель: '+esc(l.teacher_name);\n    var h='<h3>'+fmtDate(l.starts_at.slice(0,10))+', '+l.starts_at.slice(11,16)+'–'+endTime(l.starts_at,l.duration)+'</h3><div class=\"m\">'+who+(l.series&&l.series_auto?' · каждую неделю, без срока':l.series&&l.series_end?' · каждую неделю, до '+dm(l.series_end.slice(0,10)):'')+'</div>';\n    var close='<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>';\n    if(l.status==='late'){\n      if(asT)openSheet(h+'<div class=\"infobox\">Ученик отменил урок поздно — по вашему правилу он списывается с абонемента.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.voidAsk('+id+')\">Не списывать этот урок</button></div>'+close);\n      else openSheet(h+'<div class=\"infobox\">Вы отменили этот урок поздно — он списывается с абонемента.</div>'+close);\n      return;\n    }\n    if(l.past){\n      if(asT&&(l.check_needed||l.status==='pending'||l.reminder_answer==='no'))openSheet(h+'<div class=\"infobox\">'+(l.reminder_answer==='no'?'Ученик отвечал «не смогу».':'Перенос так и не подтвердили.')+' Урок состоялся? Пока вы не ответите, он не списывается.</div><div class=\"row\"><button class=\"btn\" onclick=\"A.resolve('+id+',true)\">Да, списать</button><button class=\"btn sec\" onclick=\"A.resolve('+id+',false)\">Не списывать</button></div>'+close);\n      else if(asT)openSheet(h+'<div class=\"infobox\">Урок прошёл и списан с абонемента.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.voidAsk('+id+')\">Урок не состоялся — не списывать</button></div>'+close);\n      else openSheet(h+'<div class=\"infobox\">Этот урок уже прошёл.</div>'+close);\n      return;\n    }\n    if(!asT){A.studentLesson(l,afterNo);return;}\n    var hideResched=false;\n    if(afterNo)h+='<div class=\"infobox\">Вы ответили «не подходит». Урок пока остаётся на старом времени — можно предложить своё.</div>';\n    else if(l.status==='pending'){\n      var st=lessonState(l,asT),other=asT?esc(first(l.student_name)):'учитель';\n      hideResched=true;\n      if(st.onMe)h+='<div class=\"infobox\">'+(asT?esc(first(l.student_name)):'Учитель')+' предлагает: <b>'+fmt(l.proposed_start)+'</b>'+(l.proposed_scope==='series'?' — и все следующие уроки':'')+'.</div><div class=\"row\"><button class=\"btn\" onclick=\"A.answer('+l.id+',true)\">Подтвердить</button><button class=\"btn sec\" onclick=\"A.answer('+l.id+',false)\">Не подходит</button></div>';\n      else h+='<div class=\"infobox\">Вы предложили <b>'+fmt(l.proposed_start)+'</b>. Ждём, что ответит '+other+'.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.withdraw('+l.id+')\">Отозвать предложение</button></div>'+(S.demo&&asT?'<label>Демо: ответить за ученика</label><div class=\"row\" style=\"margin-top:0\"><button class=\"btn sec\" onclick=\"A.demoAnswer('+l.id+',true)\">Подтвердить</button><button class=\"btn sec\" onclick=\"A.demoAnswer('+l.id+',false)\">Не подходит</button></div>':'');\n    }else if(l.reminder_answer==='no'){\n      if(asT)h+='<div class=\"warnbox\">Ученик ответил на напоминание: «не смогу».</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.noCharge('+l.id+')\">Отменить без списания</button></div>';\n      else h+='<div class=\"infobox\">Вы ответили «не смогу». Учитель решит, как быть с уроком. Можно предложить другое время.</div>';\n    }else if(l.clash){\n      h+='<div class=\"warnbox\">'+(asT?'Совпадает с вашей отметкой: '+esc(l.clash)+'. Предложите ученику другое время.':'У учителя в это время: '+esc(l.clash)+'.')+'</div>';\n    }\n    // Оплата — после вопроса о времени. Если там уже есть главная кнопка («Подтвердить»), эта — второстепенная.\n    if(asT&&l.pay_due){var ps=stu(l.student_id),none=ps&&!ps.paid&&!ps.used,main=!(l.status==='pending'&&lessonState(l,asT).onMe);\n      h+='<div class=\"infobox\">'+(none?'Оплаты ещё не было':'Оплаченные уроки закончились')+' — ждём оплату.</div><div class=\"row\"><button class=\"btn'+(main?'':' sec')+'\" onclick=\"A.pay('+l.student_id+')\">Получил оплату</button></div>';}\n    if(hideResched)h+='<div class=\"row\" id=\"reschedBtn\"><button class=\"btn ghost\" onclick=\"A.showResched()\">Предложить другое время</button></div>';\n    // Перенос: нажал свободное время — предложение ушло ученику. Ручной выбор — под «Другое время…».\n    h+='<div id=\"resched\"'+(hideResched?' class=\"hide\"':'')+'><label style=\"margin-top:20px\">Перенести на · нажмите время</label><div class=\"m\" style=\"font-size:14px;margin:0 0 8px\">Ученик получит предложение с кнопками «Подтвердить» и «Не подходит».</div>'+slotsBox('rsSlots');\n    h+='<div class=\"row\" id=\"otherBtn\" style=\"margin-top:6px\"><button class=\"textbtn\" onclick=\"A.showOther()\">Другое время…</button></div><div id=\"other\" class=\"hide\">'+dt('rs',l.starts_at.slice(0,10),l.starts_at.slice(11,16),true);\n    if(l.later>0&&l.series_end)h+='<label>Что переносим</label>'+opts('scope',[['one','Только этот урок'],['series',seriesLabel(l)]],'one');\n    h+='<div class=\"row\"><button class=\"btn\" id=\"sendBtn\" disabled onclick=\"A.propose('+l.id+')\">Предложить перенос</button></div><div class=\"hint\" id=\"sendHint\"></div></div></div>';\n    if(asT&&!l.series_auto&&seriesSoon(l))h+='<div class=\"infobox\">Регулярные уроки заканчиваются '+dm(l.series_end.slice(0,10))+'.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.extend('+l.series_id+')\">Продлевать автоматически</button></div>';\n    h+='<div class=\"row\" style=\"margin-top:20px\"><button class=\"btn dghost\" onclick=\"A.cancel('+l.id+')\">Отменить урок</button><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>';\n    openSheet(h);A.chk();\n    S.sending=false;api('slots',{lesson_id:l.id}).then(function(r){fillSlots('rsSlots','rs',r.slots,function(){A.proposeQuick(l.id);});}).catch(function(){fillSlots('rsSlots','rs',[]);});\n  },\n  showOther:function(){var o=document.getElementById('other'),b=document.getElementById('otherBtn');if(o)o.classList.remove('hide');if(b)b.classList.add('hide');},\n  // Шторка урока у ученика: «Не смогу прийти» → нажал свободное время — предложение ушло.\n  studentLesson:function(l,afterNo){var id=l.id,sub=subOf(l);\n    var h='<h3>'+fmtDate(l.starts_at.slice(0,10))+', '+l.starts_at.slice(11,16)+'–'+endTime(l.starts_at,l.duration)+'</h3><div class=\"m\">Учитель: '+esc(l.teacher_name)+(payMark(l)?' · '+payMark(l):'')+'</div>';\n    var close='<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>';\n    if(l.status==='pending'){var st=lessonState(l,false);\n      if(st.onMe)h+='<div class=\"infobox\">Учитель предлагает: <b>'+fmt(l.proposed_start)+'</b>'+(l.proposed_scope==='series'?' — и все следующие уроки':'')+'. Пока вы не ответили, урок остаётся на старом времени.</div><div class=\"row\"><button class=\"btn\" onclick=\"A.answer('+id+',true)\">Подтвердить</button><button class=\"btn sec\" onclick=\"A.answer('+id+',false)\">Не подходит</button></div>';\n      else h+='<div class=\"infobox\">Вы предложили <b>'+fmt(l.proposed_start)+'</b>. Ждём ответа учителя — пока урок остаётся на старом времени.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.withdraw('+id+')\">Отозвать предложение</button></div>';\n      return openSheet(h+close);}\n    if(afterNo)h+='<div class=\"infobox\">Вы ответили «не подходит». Урок пока на старом времени — можно предложить своё.</div>';\n    else if(l.reminder_answer==='no')h+='<div class=\"infobox\">Вы ответили «не смогу». Учитель решит, как быть с уроком — или предложите другое время.</div>';\n    else if(l.clash)h+='<div class=\"infobox\">У учителя в это время: '+esc(l.clash)+'. Возможно, он сам предложит другое время.</div>';\n    h+='<label style=\"margin-top:20px\">Не сможете? Перенести на</label><div class=\"m\" style=\"font-size:14px;margin:0 0 8px\">Нажмите время — учитель получит предложение.</div>'+slotsBox('rsSlots');\n    h+='<div class=\"row\" id=\"reschedBtn\" style=\"margin-top:6px\"><button class=\"textbtn\" onclick=\"A.showResched()\">Другое время…</button></div>';\n    h+='<div id=\"resched\" class=\"hide\">'+dt('rs',l.starts_at.slice(0,10),l.starts_at.slice(11,16),true);\n    if(l.later>0&&l.series_end)h+='<label>Что переносим</label>'+opts('scope',[['one','Только этот урок'],['series',seriesLabel(l)]],'one');\n    h+='<div class=\"row\"><button class=\"btn\" id=\"sendBtn\" disabled onclick=\"A.propose('+id+')\">Предложить перенос</button></div><div class=\"hint\" id=\"sendHint\"></div></div>';\n    h+='<div class=\"row\" style=\"margin-top:20px\"><button class=\"btn dghost\" onclick=\"A.cancel('+id+')\">Отменить урок</button><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>';\n    if(sub&&sub.late_hours)h+='<div class=\"hint\">Отмена позже чем за '+sub.late_hours+' ч до урока — урок списывается с абонемента.</div>';\n    openSheet(h);A.chk();S.sending=false;\n    api('slots',{lesson_id:id}).then(function(r){fillSlots('rsSlots','rs',r.slots,function(){A.proposeQuick(id);});}).catch(function(){fillSlots('rsSlots','rs',[]);});\n  },\n  proposeQuick:function(id){var ts=readTs('rs');if(!ts||S.sending)return;S.sending=true;\n    api('lesson/propose',{id:id,starts_at:ts,scope:'one'}).then(function(r){S.sending=false;\n      if(r.conflict){conflictSheet(r.conflict,'lesson/propose',{},null,function(){A.lesson(id);});return;}\n      closeSheet();load();toast('Предложено: '+fmtShort(ts)+'. Пока урок на старом времени','Отозвать',function(){act('lesson/withdraw',{id:id},'Предложение отозвано');});\n    }).catch(function(){S.sending=false;});},\n  propose:function(id){var ts=readTs('rs');if(!ts)return;var sc=optVal('scope')||'one';\n    act('lesson/propose',{id:id,starts_at:ts,scope:sc},'Предложение отправлено',function(){A.lesson(id);setTimeout(function(){A.showResched();A.showOther();setTs('rs',ts);A.touch();},0);});},\n  withdraw:function(id){act('lesson/withdraw',{id:id},'Предложение отозвано');},\n  answer:function(id,ok){var l=L(id);if(!l)return;\n    if(ok)return api('lesson/answer',{id:id,accept:true,code:l.proposed_start}).then(function(){closeSheet();toast('Перенос подтверждён');load();}).catch(function(){closeSheet();load();});\n    api('lesson/answer',{id:id,accept:false,code:l.proposed_start}).then(load).then(function(){A.lesson(id,true);}).catch(function(){});},\n  resolve:function(id,held){act('lesson/resolve',{id:id,held:held},held?'Урок списан':'Урок не списан, ученик получил сообщение');},\n  extend:function(sid){api('series/extend',{series_id:sid}).then(function(r){closeSheet();toast(r.skipped&&r.skipped.length?'Продлевается само. Пропущено занятых недель: '+r.skipped.length:'Готово: уроки будут продлеваться сами');load();}).catch(function(){});},\n  noCharge:function(id){var l=L(id);openSheet('<h3>Отменить без списания?</h3><div class=\"m\">'+esc(l.student_name)+', '+fmt(l.starts_at)+'. Урок не спишется с абонемента, ученик получит сообщение.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Не отменять</button><button class=\"btn danger\" onclick=\"A.noChargeDo('+id+')\">Отменить урок</button></div>');},\n  noChargeDo:function(id){act('lesson/cancel',{id:id,scope:'one'},'Урок отменён без списания');},\n  voidAsk:function(id){var l=L(id);openSheet('<h3>Не списывать урок?</h3><div class=\"m\">'+esc(l.student_name)+', '+fmt(l.starts_at)+'. Урок вернётся на абонемент ученика, ему придёт сообщение.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Отмена</button><button class=\"btn\" onclick=\"A.voidDo('+id+')\">Не списывать</button></div>');},\n  voidDo:function(id){act('lesson/void',{id:id},'Урок не списан');},\n  cancel:function(id){var l=L(id),asT=S.mode==='t'&&l.is_teaching;var h='<h3>Отменить урок?</h3><div class=\"m\">'+fmt(l.starts_at)+'. '+(asT?'Ученик получит сообщение. С абонемента не списывается.':'Учитель получит сообщение.')+'</div>';\n    if(!asT&&l.late_charge)h+='<div class=\"warnbox\">Это поздняя отмена: до урока меньше '+l.late_hours+' ч. По правилу учителя урок будет списан с абонемента. Лучше предложить другое время.</div>';\n    if(l.later>0&&l.series_end)h+='<label>Что отменяем</label>'+opts('cscope',[['one','Только этот урок'],['series',seriesLabel(l,true)]],'one');\n    openSheet(h+'<div class=\"row\"><button class=\"btn sec\" onclick=\"A.lesson('+id+')\">Не отменять</button><button class=\"btn danger\" onclick=\"A.cancelDo('+id+')\">Да, отменить</button></div>');},\n  cancelDo:function(id){api('lesson/cancel',{id:id,scope:optVal('cscope')||'one'}).then(function(r){closeSheet();toast(r.count>1?'Отменено: '+lw(r.count):'Урок отменён');load();}).catch(function(){});},\n\n  addLesson:function(sid){\n    var d=S.data;if(!d.students.length){S.tab='students';render();toast('Сначала пригласите ученика');return;}\n    S.cur=null;var def=addDays(today(),1);\n    var h='<h3>Новый урок</h3><label for=\"als\">Ученик</label><select id=\"als\">'+(sid||d.students.length===1?'':'<option value=\"\" selected disabled>Выберите ученика</option>')+d.students.map(function(s){return '<option value=\"'+s.id+'\"'+(s.id===sid?' selected':'')+'>'+esc(s.name)+'</option>';}).join('')+'</select>'+dt('al',def,'15:00');\n    h+='<label>Длительность</label>'+opts('dur',[[45,'45 мин'],[60,'60 мин'],[90,'90 мин']],d.settings.default_duration);\n    h+='<label>Повтор</label>'+opts('rep',[['w','Каждую неделю'],['1','Один раз']],'w');\n    h+='<div id=\"weeksRow\" class=\"hint\">Без срока — уроки продлеваются сами. Остановить: «Отменить урок» → «Этот и все следующие».</div>';\n    openSheet(h+'<div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Отмена</button><button class=\"btn\" onclick=\"A.addDo()\">Добавить</button></div>');\n  },\n  addDo:function(){var ts=readTs('al');if(!ts){toast('Укажите дату и время');return;}var sid=+document.getElementById('als').value;if(!sid){toast('Выберите ученика');return;}var weekly=optVal('rep')!=='1';var dur=+(optVal('dur')||60);\n    act('lesson/add',{student_id:sid,starts_at:ts,weeks:1,auto:weekly,duration:dur},weekly?'Добавлено: каждую неделю':'Урок добавлен',function(){A.addLesson(sid);setTimeout(function(){setTs('al',ts);},0);});},\n\n  busy:function(){\n    var h='<h3>Я занят</h3><div class=\"m\">Отметьте концерт или другое дело. Уроки в это время подсветятся, и всем можно сразу предложить перенос.</div>';\n    h+='<label for=\"bn\">Что</label><input id=\"bn\" value=\"Концерт\" maxlength=\"60\"><div class=\"hint\">Ученики увидят эту подпись, если их урок совпадёт.</div><label for=\"bd\">Дата</label><input type=\"date\" id=\"bd\" value=\"'+today()+'\" min=\"'+today()+'\">';\n    h+='<label>Время</label>'+opts('allday',[['1','Весь день'],['0','Часы']],'1')+'<div id=\"bhrs\" class=\"two\" style=\"display:none\"><div><label for=\"bf\">С</label><input type=\"time\" id=\"bf\" step=\"900\" value=\"14:00\"></div><div><label for=\"bt\">До</label><input type=\"time\" id=\"bt\" step=\"900\" value=\"22:00\"></div></div>';\n    h+='<div class=\"hint\">Несколько дней — отметьте каждый день отдельно.</div>';\n    openSheet(h+'<div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Отмена</button><button class=\"btn\" onclick=\"A.busyDo()\">Отметить</button></div>');\n  },\n  busyDo:function(){var date=document.getElementById('bd').value,all=optVal('allday')==='1';\n    api('busy/add',{date:date,all_day:all,from:document.getElementById('bf').value,to:document.getElementById('bt').value,note:document.getElementById('bn').value}).then(function(r){\n      S.weekStart=monday(date);return load().then(function(){var aff=r.affected.filter(function(x){return x.starts_at>S.data.now&&x.status!=='pending';});if(aff.length)A.moveAll(aff);else{closeSheet();toast('Отмечено. Переносить нечего');}});\n    }).catch(function(){});},\n  moveBusy:function(bid){var b=S.data.busy.filter(function(x){return x.id===bid;})[0];var aff=busyAffected(b).map(function(l){return {id:l.id,starts_at:l.starts_at,student_name:l.student_name,status:l.status};});if(aff.length)A.moveAll(aff);},\n  moveAll:function(aff,note){\n    S.moving=aff;\n    var h='<h3>'+(note?'Выберите другое время':'Уроки на это время: '+aff.length)+'</h3><div class=\"m\">'+(note||'Нажмите на свободное время или укажите своё — ученики получат предложение с кнопками «Подтвердить» и «Не подходит».')+'</div>';\n    aff.forEach(function(a,i){h+='<div class=\"mvrow\"><label class=\"hd\"><input type=\"checkbox\" id=\"mvc'+i+'\" checked><span><b>'+esc(a.student_name)+'</b><span class=\"m\" style=\"display:block;font-size:14px\">сейчас: '+fmtShort(a.starts_at)+'</span></span></label>'+slotsBox('mvs'+i)+dt('mv'+i,addDays(a.starts_at.slice(0,10),1),a.starts_at.slice(11,16))+'</div>';});\n    openSheet(h+'<div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Позже</button><button class=\"btn\" onclick=\"A.moveAllDo()\">Отправить предложения</button></div><div class=\"hint\">«Позже» — вернуться можно кнопкой «Перенести уроки» в расписании.</div>');\n    aff.forEach(function(a,i){api('slots',{lesson_id:a.id,limit:4}).then(function(r){fillSlots('mvs'+i,'mv'+i,r.slots);var best=r.best||r.slots[0];if(best){setTs('mv'+i,best);var b=document.querySelector('#mvs'+i+' button[data-ts=\"'+best+'\"]');if(b)b.setAttribute('aria-pressed','true');}}).catch(function(){fillSlots('mvs'+i,'mv'+i,[]);});});\n  },\n  moveAllDo:function(){\n    var items=[];S.moving.forEach(function(a,i){var c=document.getElementById('mvc'+i);if(c&&!c.checked)return;var ts=readTs('mv'+i);if(ts)items.push({id:a.id,starts_at:ts});});\n    if(!items.length){toast('Ничего не выбрано');return;}\n    var seen={};for(var k=0;k<items.length;k++){if(seen[items[k].starts_at]){toast('Два ученика на одно время: '+fmtShort(items[k].starts_at));return;}seen[items[k].starts_at]=1;}\n    api('lesson/propose_many',{items:items}).then(function(r){\n      var bad=r.results.filter(function(x){return !x.ok;}),ok=r.results.length-bad.length;\n      if(!bad.length){closeSheet();toast('Отправлено предложений: '+ok);load();return;}\n      S.failedMoving=S.moving.filter(function(m){return bad.some(function(x){return x.id===m.id;});});\n      var h='<h3>Отправлено: '+ok+' из '+r.results.length+'</h3><div class=\"m\">Это время занято, предложение не отправлено:</div>';\n      bad.forEach(function(x){var a=S.moving.filter(function(m){return m.id===x.id;})[0];h+='<div class=\"warnbox\"><b>'+esc(a?a.student_name:'')+'</b>: '+esc(x.problem)+'</div>';});\n      h+='<div class=\"row\"><button class=\"btn\" onclick=\"A.retryFailed()\">Выбрать другое время</button></div><div class=\"row\" style=\"margin-top:4px\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Позже</button></div>';\n      openSheet(h);load();\n    }).catch(function(){});},\n  retryFailed:function(){A.moveAll(S.failedMoving,'Для этих уроков выбранное время оказалось занятым.');},\n  unbusy:function(id){var b=S.data.busy.filter(function(x){return x.id===id;})[0];\n    openSheet('<h3>Убрать отметку?</h3><div class=\"m\">'+esc(b.note)+', '+fmtDate(b.day)+'. Уже отправленные предложения переноса останутся.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Оставить</button><button class=\"btn danger\" onclick=\"A.unbusyDo('+id+')\">Убрать</button></div>');},\n  unbusyDo:function(id){act('busy/remove',{id:id},'Отметка убрана');},\n\n  // Карточка ученика: «Получил оплату», уроки, история оплат.\n  student:function(id){var s=stu(id);if(!s)return;var d=S.data,due=isDue(s);\n    var ls=d.lessons.filter(function(l){return l.student_id===id&&l.is_teaching&&!l.past&&l.status!=='late';}).slice(0,4);\n    var ps=(d.payments||[]).filter(function(p){return p.student_id===id;});\n    var bal=balText(s.left,s.paid,s.used),col=s.left<0?'var(--bad)':due?'var(--attn)':'';\n    var h='<h3>'+esc(s.name)+'</h3><div class=\"m\">'+(d.uses_pay?'<span'+(col?' style=\"color:'+col+'\"':'')+'>'+bal.charAt(0).toUpperCase()+bal.slice(1)+'</span>':'Ученик')+(s.next?' · следующий '+fmtShort(s.next):'')+'</div>';\n    if(due)h+='<div class=\"row\"><button class=\"btn\" onclick=\"A.pay('+id+')\">Получил оплату</button></div>';\n    h+='<div class=\"row\"><button class=\"btn sec\" onclick=\"A.addLesson('+id+')\">+ Урок</button>'+(due?'<button class=\"btn sec\" onclick=\"A.remind('+id+')\">Напомнить</button>':'<button class=\"btn sec\" onclick=\"A.pay('+id+')\">Получил оплату</button>')+'</div>';\n    h+='<div class=\"sect\">Ближайшие уроки</div>';\n    if(!ls.length)h+='<div class=\"m\" style=\"padding:10px 0\">Нет запланированных уроков.</div>';\n    else h+='<div class=\"group\">'+ls.map(function(l){var st=lessonState(l,true);return '<button class=\"card\" onclick=\"A.lesson('+l.id+')\"><span class=\"t\">'+l.starts_at.slice(11,16)+'</span><span class=\"n\"><b>'+fmtDate(l.starts_at.slice(0,10))+'</b>'+(st.note?'<span>'+esc(st.note)+'</span>':'')+'</span>'+st.chip+'</button>';}).join('')+'</div>';\n    if(ps.length)h+='<div class=\"sect\">Оплаты</div><div class=\"group\">'+ps.slice(0,6).map(payHist).join('')+'</div>';\n    h+='<div class=\"row\" style=\"margin-top:20px\"><button class=\"btn dghost\" onclick=\"A.removeAsk('+id+')\">Убрать ученика</button><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>';\n    openSheet(h);},\n  removeAsk:function(id){var s=stu(id);openSheet('<h3>Убрать ученика?</h3><div class=\"m\">'+esc(s.name)+' пропадёт из списка, его будущие уроки отменятся, ему придёт сообщение. Вернуться он сможет по ссылке-приглашению.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.student('+id+')\">Не убирать</button><button class=\"btn danger\" onclick=\"A.removeDo('+id+')\">Убрать</button></div>');},\n  removeDo:function(id){act('student/remove',{id:id},'Ученик убран');},\n\n  payHistory:function(){var ps=S.data.payments||[];openSheet('<h3>История оплат</h3><div class=\"group\" style=\"margin-top:14px\">'+ps.map(payHist).join('')+'</div>'+'<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>');},\n  // «Получил оплату»: за сколько уроков (1 / абонемент / 2 абонемента / другое), сумма считается сама и правится,\n  // сразу видно, что станет с остатком. «Начальный остаток» — тихой ссылкой, только пока у ученика не было оплат.\n  // С главной кнопки: ученик подставлен сам (урок сегодня и ждём оплату) — остаётся «Записать». Иначе — «От кого?».\n  payStart:function(){var d=S.data;if(!d.students.length){A.invite();return;}\n    var f=payOrder()[0];if(d.students.length===1||(f.today_at&&isDue(f)))A.pay(f.id,true);else A.payWho(false);},\n  payWho:function(all){var o=payOrder(),top=o.filter(function(s){return s.today_at||isDue(s);}),list=all||!top.length?o:top.slice(0,6);\n    var h='<h3>Получил оплату</h3><div class=\"m\">От кого?</div>';\n    if(list.length>8)h+='<div style=\"margin-top:14px\">'+searchBox('pq','Найти ученика')+'</div>';\n    h+='<div class=\"grp group\" style=\"margin-top:14px\">'+list.map(payRow).join('')+'</div>';\n    if(list.length<o.length)h+='<div class=\"row\" style=\"margin-top:0\"><button class=\"textbtn\" onclick=\"A.payWho(true)\">Все ученики ('+o.length+')</button></div>';\n    openSheet(h+'<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Отмена</button></div>');},\n  pay:function(id,pick){var s=stu(id),set=S.data.settings;if(!s)return;S.pay={id:id,n:set.pack_size,kind:'pay',own:false};\n    var h='<h3 id=\"payTitle\">Получил оплату</h3>';\n    if(pick&&S.data.students.length>1)h+='<div class=\"group\" style=\"margin-top:12px\"><button class=\"card\" onclick=\"A.payWho(false)\"><span class=\"n\"><b>'+esc(s.name)+'</b><span>'+payWhen(s)+' · '+balText(s.left,s.paid,s.used)+'</span></span><span class=\"r\" style=\"color:var(--tint)\">Другой</span></button></div>';\n    else h+='<div class=\"m\">'+esc(s.name)+' · '+balText(s.left,s.paid,s.used)+'</div>';\n    h+='<label>За сколько уроков</label><div class=\"opts\" data-name=\"pn\">'+payPresets(set).map(function(n){return '<button type=\"button\" aria-pressed=\"'+(n===set.pack_size)+'\" data-v=\"'+n+'\" onclick=\"A.payN(this)\">'+n+'</button>';}).join('')+'<button type=\"button\" aria-pressed=\"false\" data-v=\"x\" onclick=\"A.payN(this)\">Другое</button></div>';\n    h+='<div id=\"pnBox\" style=\"display:none;margin-top:10px\"><input type=\"number\" inputmode=\"numeric\" id=\"pn\" min=\"1\" max=\"100\" placeholder=\"Число уроков\" aria-label=\"Число уроков\" oninput=\"A.payUpd()\"></div>';\n    h+='<div id=\"pamt\"><label for=\"pa\">Сумма, zł</label><input type=\"number\" inputmode=\"numeric\" id=\"pa\" min=\"0\" placeholder=\"необязательно\" oninput=\"A.payOwn()\"></div>';\n    h+='<div class=\"infobox\" id=\"pres\"></div>';\n    h+='<div class=\"row\"><button class=\"btn\" id=\"paySave\" onclick=\"A.payDo()\"></button></div>';\n    if(!s.paid)h+='<div class=\"row\" style=\"margin-top:0\"><button class=\"textbtn\" id=\"pkind\" onclick=\"A.payKind()\">Уроки оплачены ещё до SlotMate?</button></div>';\n    h+='<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Отмена</button></div>';\n    openSheet(h);A.payUpd();},\n  payN:function(b){Array.prototype.forEach.call(b.parentNode.children,function(c){c.setAttribute('aria-pressed','false');});b.setAttribute('aria-pressed','true');\n    var other=b.getAttribute('data-v')==='x',box=document.getElementById('pnBox');box.style.display=other?'':'none';\n    S.pay.n=other?(+document.getElementById('pn').value||0):+b.getAttribute('data-v');S.pay.own=false;A.payUpd();if(other)document.getElementById('pn').focus();},\n  payOwn:function(){S.pay.own=true;A.payUpd();},\n  payKind:function(){S.pay.kind=S.pay.kind==='initial'?'pay':'initial';A.payUpd();},\n  payUpd:function(){var P=S.pay,s=stu(P.id),set=S.data.settings,ini=P.kind==='initial',pa=document.getElementById('pa');\n    if(optVal('pn')==='x')P.n=Math.round(+document.getElementById('pn').value)||0;\n    var ok=P.n>=1&&P.n<=100;\n    if(!P.own)pa.value=ok&&!ini?(priceFor(set,P.n)||''):'';\n    var amt=ini?0:Math.max(Math.round(+pa.value)||0,0);\n    document.getElementById('payTitle').textContent=ini?'Начальный остаток':'Получил оплату';\n    document.getElementById('pamt').style.display=ini?'none':'';\n    var k=document.getElementById('pkind');if(k)k.textContent=ini?'Нет, это новая оплата':'Уроки оплачены ещё до SlotMate?';\n    var left=s.left+(ok?P.n:0),res=left>0?'осталось '+lw(left):left===0?(s.left<0?'долг закрыт':'0 уроков'):'долг '+lw(-left);\n    document.getElementById('pres').innerHTML=!ok?'Укажите, за сколько уроков.':ini?'Сколько оплаченных уроков у ученика было до SlotMate. После этого — <b>'+res+'</b>. Ученику сообщение не придёт.':'После этого — <b>'+res+'</b>. Ученику придёт подтверждение.';\n    var b=document.getElementById('paySave');b.disabled=!ok;b.textContent=!ok?'Записать':(ini?'Записать остаток · ':'Записать · ')+lw(P.n)+(amt?' · '+amt+' zł':'');},\n  payDo:function(){var b=document.getElementById('paySave'),P=S.pay;if(!P||b.disabled)return;var s=stu(P.id),ini=P.kind==='initial',n=P.n,a=ini?0:Math.max(Math.round(+document.getElementById('pa').value)||0,0);\n    if(!(n>=1&&n<=100)){toast('Укажите, за сколько уроков');return;}b.disabled=true;\n    api('pay/add',{student_id:P.id,lessons:n,amount:a,kind:P.kind}).then(function(r){closeSheet();load();toast((ini?'Начальный остаток: ':'Записано: ')+first(s.name)+', +'+lw(n)+(a?' · '+a+' zł':''),'Отменить',function(){api('pay/undo',{id:r.id}).then(function(){toast('Оплата отменена');load();}).catch(function(){});});}).catch(function(){b.disabled=false;});},\n  // Муляж: настоящей оплаты в приложении пока нет — учитель отмечает оплату сам.\n  paySoon:function(){openSheet('<h3>Оплата пока недоступна</h3><div class=\"m\">Скоро здесь можно будет оплатить уроки картой или BLIK. Пока платите учителю, как обычно, — он отметит оплату, и абонемент обновится.</div><button class=\"btn\" onclick=\"closeSheetX()\">Понятно</button>');},\n  claim:function(subId){var s=S.data.my_subs.filter(function(x){return x.id===subId;})[0];if(!s)return;\n    openSheet('<h3>Я оплатил</h3><div class=\"m\">Учитель'+(S.data.my_subs.length>1?' ('+esc(s.teacher_name)+')':'')+' получит сообщение и подтвердит. До подтверждения абонемент не меняется.</div><div class=\"two\"><div><label for=\"cn\">Уроков</label><input type=\"number\" inputmode=\"numeric\" id=\"cn\" min=\"1\" value=\"'+s.pack_size+'\"></div><div><label for=\"ca\">Сумма, zł</label><input type=\"number\" inputmode=\"numeric\" id=\"ca\" min=\"0\" value=\"'+(s.pack_price||'')+'\" placeholder=\"необязательно\"></div></div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Отмена</button><button class=\"btn\" id=\"claimSave\" onclick=\"A.claimDo('+subId+')\">Отправить учителю</button></div>');},\n  claimDo:function(subId){var b=document.getElementById('claimSave');if(b.disabled)return;var n=+document.getElementById('cn').value;if(!(n>=1)){toast('Укажите, сколько уроков');return;}b.disabled=true;\n    api('pay/claim',{sub_id:subId,lessons:n,amount:+document.getElementById('ca').value||0}).then(function(){closeSheet();toast('Отправлено учителю');load();}).catch(function(){b.disabled=false;});},\n  claimAnswer:function(id,ok){act('pay/claim_answer',{id:id,ok:ok},ok?'Оплата записана':'Ученик получил сообщение');},\n  payUndoAsk:function(id){var p=(S.data.payments||[]).filter(function(x){return x.id===id;})[0];\n    openSheet('<h3>Отменить оплату?</h3><div class=\"m\">'+esc(p.name)+': '+lw(p.lessons)+(p.amount?', '+p.amount+' zł':'')+'.'+(p.kind==='initial'?' Это начальный остаток — ученик сообщения не получит.':' Ученику придёт сообщение, что это была ошибка.')+'</div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Оставить</button><button class=\"btn danger\" onclick=\"A.payUndoDo('+id+')\">Отменить оплату</button></div>');},\n  payUndoDo:function(id){act('pay/undo',{id:id},'Оплата отменена');},\n  remind:function(id){api('pay/remind',{student_id:id}).then(function(r){toast(r.sent?'Напоминание отправлено':'У ученика ещё есть оплаченные уроки');}).catch(function(){});},\n  remindAll:function(){var ids=S.data.students.filter(isDue).map(function(s){return s.id;});S.remindIds=ids;\n    openSheet('<h3>Напомнить об оплате?</h3><div class=\"m\">Сообщение получат: '+ids.map(function(i){return esc(stu(i).name);}).join(', ')+'.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"closeSheetX()\">Отмена</button><button class=\"btn\" onclick=\"A.remindAllDo()\">Отправить</button></div>');},\n  remindAllDo:function(){api('pay/remind',{student_ids:S.remindIds}).then(function(r){closeSheet();toast('Отправлено напоминаний: '+r.sent);}).catch(function(){});},\n\n  settings:function(){var d=S.data,h='<h3>Настройки</h3>';\n    if(d.is_teacher&&S.mode==='t'){var st=d.settings;\n      h+='<div class=\"sect\">Абонемент</div><div class=\"two\"><div><label for=\"sps\">Уроков</label><input type=\"number\" inputmode=\"numeric\" id=\"sps\" min=\"1\" value=\"'+st.pack_size+'\"></div><div><label for=\"spp\">Цена, zł</label><input type=\"number\" inputmode=\"numeric\" id=\"spp\" min=\"0\" value=\"'+(st.pack_price||'')+'\"></div></div><div class=\"hint\">Подставляется, когда вы отмечаете оплату. Ученик может оплатить и 1 урок, и 8 — сумма посчитается по цене урока, её можно поправить.</div>';\n      h+='<label>Длительность урока по умолчанию</label>'+opts('sdur',[[45,'45 мин'],[60,'60 мин'],[90,'90 мин']],st.default_duration);\n      h+='<label>Ученик отменил поздно — списать?</label>'+opts('slate',[[0,'Нет'],[6,'< 6 ч'],[12,'< 12 ч'],[24,'< 24 ч']],st.late_hours)+'<div class=\"hint\">Если ученик сам отменит урок позже этого срока, урок спишется. Вы всегда отменяете без списания.</div>';\n      h+='<div class=\"row\"><button class=\"btn\" onclick=\"A.saveSettings()\">Сохранить</button></div>';}\n    h+='<div class=\"sect\">Календарь телефона</div><div class=\"m\">Подпишитесь один раз — уроки и переносы будут появляться в календаре сами.</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.calendar()\">Получить ссылку</button></div>';\n    if(d.is_admin&&!S.demo)h+='<div class=\"sect\">Владелец</div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.teacherInvite()\">Ссылка для нового учителя</button></div><div class=\"row\"><button class=\"btn sec\" onclick=\"A.demo()\">Кабинет учителя (демо)</button></div>';\n    openSheet(h+'<div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>');},\n  saveSettings:function(){act('settings',{pack_size:+document.getElementById('sps').value,pack_price:+document.getElementById('spp').value||0,default_duration:+optVal('sdur'),late_hours:+optVal('slate')},'Сохранено');},\n  calendar:function(){api('calendar').then(function(r){S.calLink=r.link;openSheet('<h3>Календарь телефона</h3><div class=\"m\">Это ваша личная ссылка, никому её не пересылайте.</div><div class=\"link\">'+esc(r.link)+'</div><div class=\"row\"><button class=\"btn\" onclick=\"A.copyCal()\">Скопировать</button></div><div class=\"m\" style=\"margin-top:14px\"><b>iPhone:</b> Настройки → Приложения → Календарь → Учётные записи → Добавить → Другое → Подписной календарь → вставьте ссылку.<br><br><b>Google Календарь:</b> на компьютере «Другие календари» → «+» → «Добавить по URL». Google обновляет такие календари с задержкой до суток.</div><div class=\"row\"><button class=\"btn mute\" onclick=\"closeSheetX()\">Закрыть</button></div>');}).catch(function(){});},\n  copyCal:function(){copyText(S.calLink);},\n  invite:function(){api('invite').then(function(r){share(r.link,'Записывайтесь ко мне на уроки через SlotMate — откройте ссылку в Телеграме:');}).catch(function(){});},\n  teacherInvite:function(){api('teacher_invite').then(function(r){share(r.link,'Ваш кабинет учителя в SlotMate — откройте ссылку в Телеграме:');}).catch(function(){});},\n  demo:function(){S.demo=true;S.mode='t';S.tab='week';S.weekStart=null;closeSheet();window.scrollTo(0,0);load().then(function(){toast('Демо: выдуманные ученики, сообщения не отправляются');}).catch(function(){S.demo=false;});},\n  demoExit:function(){S.demo=false;S.mode='';S.tab='week';S.weekStart=null;closeSheet();window.scrollTo(0,0);load();},\n  demoReset:function(){api('demo/reset').then(function(){S.weekStart=null;return load();}).then(function(){toast('Демо сброшено');}).catch(function(){});},\n  demoAnswer:function(id,ok){api('demo/as_student',{id:id,accept:ok}).then(function(){closeSheet();toast(ok?'Ученик подтвердил перенос':'Ученик ответил «не подходит»');load();}).catch(function(){});},\n  help:function(){openSheet('<h3>Как это работает</h3><div class=\"m\">Время урока меняется, только когда подтвердили обе стороны. Пока ответа нет, урок остаётся на старом времени.<br><br>Если учитель предложит перенос, в Телеграм придёт сообщение с кнопками «Подтвердить» и «Не подходит». Ответить можно и здесь.<br><br>Не сможете прийти — нажмите «Не смогу прийти» и выберите свободное время: учитель получит предложение. Там же можно отменить урок.<br><br>За сутки до урока придёт напоминание с кнопками «Буду» и «Не смогу».<br><br>Оплату абонемента отмечает учитель — после этого уроки появятся на абонементе. Оплатить прямо в приложении можно будет позже.</div><div class=\"row\"><button class=\"btn\" onclick=\"closeSheetX()\">Понятно</button></div>');}\n};\nwindow.A=A;window.closeSheetX=closeSheet;\nfunction copyText(t){if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){toast('Скопировано');},function(){toast('Выделите ссылку и скопируйте');});else toast('Выделите ссылку и скопируйте');}\nfunction share(link,text){\n  if(tg&&tg.openTelegramLink){tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text));}\n  else{S.shareLink=link;openSheet('<h3>Ссылка-приглашение</h3><div class=\"link\">'+esc(link)+'</div><div class=\"row\"><button class=\"btn\" onclick=\"A.copyShare()\">Скопировать</button></div>');}\n}\nA.copyShare=function(){copyText(S.shareLink);};\nload().catch(function(e){document.getElementById('app').innerHTML='<div class=\"lead\">Не удалось открыть: '+esc(e.message)+'.<br>Откройте приложение из чата с ботом.</div>';});\n})();\n</script>\n</body>\n</html>\n";

const TZ = 'Europe/Warsaw';
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_PLURAL = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const SCHEMA_VERSION = 6;
const ACTIVE = "('scheduled', 'pending')";
// Урок списывается, если он прошёл и с ним всё ясно: не висит перенос, ученик не писал «не смогу» без решения учителя.
const USED = "(l.status = 'late' OR (l.status = 'scheduled' AND l.check_needed = 0 AND COALESCE(l.reminder_answer, '') != 'no'))";

// Демо-кабинет учителя для владельца: выдуманный учитель и ученики с отрицательными номерами.
const DEMO_T = -1000;
const DEMO_STUDENTS = [['Ола', 0, '17:00', 4], ['Марек', 1, '18:00', 0], ['Кася', 2, '16:00', 8], ['Томек', 3, '19:00', 4], ['Зося', 5, '11:00', 2], ['Бартек', 5, '12:30', -3]];

let schemaReady = false;
let botUsername = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.DB) return text('Не подключена база: добавьте привязку D1 с именем DB.');
    if (!env.BOT_TOKEN) return text('Не задан секрет BOT_TOKEN.');
    await ensureSchema(env);

    if (url.pathname === '/setup') return setup(url, env);
    if (url.pathname === '/app' || url.pathname === '/app/') {
      return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (url.pathname.startsWith('/api/') && request.method === 'POST') {
      try { return await handleApi(request, env, url); } catch (e) {
        console.error('api failed', url.pathname, (e && e.stack) || e);
        return json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, 500);
      }
    }
    if (url.pathname.startsWith('/cal/')) return calendarFeed(url, env);
    if (url.pathname === '/telegram' && request.method === 'POST') {
      const secret = await webhookSecret(env);
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return new Response('forbidden', { status: 403 });
      let update;
      try { update = await request.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
      try { await handleUpdate(update, env, url.origin); } catch (e) { console.error('update failed', (e && e.stack) || e); }
      return new Response('ok');
    }
    return text('SlotMate работает.');
  },

  async scheduled(event, env, ctx) {
    if (!env.DB || !env.BOT_TOKEN) return;
    await ensureSchema(env);
    const origin = env.PUBLIC_URL || (await env.DB.prepare("SELECT v FROM meta WHERE k = 'origin'").first() || {}).v || '';
    await runHourly(env, origin);
  },
};

// ---------- база данных ----------

async function ensureSchema(env) {
  if (schemaReady) return;
  const create = [
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (
      tg_id INTEGER PRIMARY KEY, name TEXT, username TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0, is_teacher INTEGER NOT NULL DEFAULT 0,
      invite_code TEXT, cal_key TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL,
      name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (tg_id, teacher_id))`,
    `CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY, kind TEXT NOT NULL, created_by INTEGER, used_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'scheduled', proposed_start TEXT, proposed_by TEXT,
      reminded INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS busy (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, day TEXT NOT NULL,
      from_t TEXT NOT NULL, to_t TEXT NOT NULL, note TEXT)`,
    `CREATE TABLE IF NOT EXISTS teacher_settings (teacher_id INTEGER PRIMARY KEY, pack_size INTEGER NOT NULL DEFAULT 4, pack_price INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      lessons INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    // Серии «каждую неделю без срока»: продлеваются сами.
    `CREATE TABLE IF NOT EXISTS series_auto (series_id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL)`,
    // Ученик нажал «Я оплатил» — ждём, что ответит учитель.
    `CREATE TABLE IF NOT EXISTS pay_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      lessons INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
      msg_chat INTEGER, msg_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON lessons (teacher_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons (student_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_users_invite ON users (invite_code)`,
    `CREATE INDEX IF NOT EXISTS idx_users_cal ON users (cal_key)`,
    `CREATE INDEX IF NOT EXISTS idx_busy ON busy (teacher_id, day)`,
  ];
  await env.DB.batch(create.map((s) => env.DB.prepare(s)));
  const ver = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schema'").first();
  if (!ver || Number(ver.v) < SCHEMA_VERSION) {
    const alters = [
      'ALTER TABLE lessons ADD COLUMN series_id INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposed_scope TEXT',
      'ALTER TABLE lessons ADD COLUMN proposal_chat INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposal_msg INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposed_at TEXT',
      'ALTER TABLE lessons ADD COLUMN pinged INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE lessons ADD COLUMN reminder_answer TEXT',
      'ALTER TABLE users ADD COLUMN last_summary TEXT',
      'ALTER TABLE teacher_settings ADD COLUMN default_duration INTEGER NOT NULL DEFAULT 60',
      'ALTER TABLE teacher_settings ADD COLUMN late_hours INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE payments ADD COLUMN kind TEXT',
      'ALTER TABLE lessons ADD COLUMN check_needed INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE lessons ADD COLUMN pay_asked INTEGER NOT NULL DEFAULT 0',
    ];
    for (const a of alters) {
      try { await env.DB.prepare(a).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) console.error('migration failed', a, e && e.message); }
    }
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").bind(String(SCHEMA_VERSION)).run();
  }
  schemaReady = true;
}

async function upsertUser(env, from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Без имени';
  await env.DB.prepare(
    `INSERT INTO users (tg_id, name, username) VALUES (?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username`
  ).bind(from.id, name, from.username || null).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(from.id).first();
  const admins = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').first();
  if (!admins || !admins.c) {
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE tg_id = ?').bind(user.tg_id).run();
    user.is_admin = 1;
  }
  return user;
}

async function isStudentAnywhere(env, tgId) {
  const row = await env.DB.prepare('SELECT 1 AS x FROM students WHERE tg_id = ? LIMIT 1').bind(tgId).first();
  return !!row;
}

const LESSON_SELECT = `SELECT l.*, s.tg_id AS student_tg, su.name AS student_name, tu.name AS teacher_name
  FROM lessons l JOIN students s ON s.id = l.student_id
  JOIN users su ON su.tg_id = s.tg_id JOIN users tu ON tu.tg_id = l.teacher_id`;

async function loadLesson(env, lid) {
  if (!Number.isFinite(lid)) return null;
  return env.DB.prepare(`${LESSON_SELECT} WHERE l.id = ?`).bind(lid).first();
}

function roles(lesson, uid) {
  return { t: lesson.teacher_id === uid, s: lesson.student_tg === uid };
}

async function settingsOf(env, teacherId) {
  const s = await env.DB.prepare('SELECT * FROM teacher_settings WHERE teacher_id = ?').bind(teacherId).first();
  return { pack_size: 4, pack_price: 0, default_duration: 60, late_hours: 0, ...(s || {}) };
}

async function balanceOf(env, studentId) {
  const paid = await env.DB.prepare('SELECT COALESCE(SUM(lessons), 0) AS n FROM payments WHERE student_id = ?').bind(studentId).first();
  const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lessons l WHERE l.student_id = ? AND ${USED} AND l.starts_at < ?`).bind(studentId, nowLocal()).first();
  return { paid: Number(paid.n), used: Number(used.n), left: Number(paid.n) - Number(used.n) };
}

// ---------- помощники ----------

// Сколько строк изменил запрос (0 — условие не совпало, например кто-то успел раньше).
function changed(res) { return !!(res && res.meta && res.meta.changes > 0); }
function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function lessonsWord(n) { return `${n} ${plural(n, 'урок', 'урока', 'уроков')}`; }
function balanceLine(left) { return left > 0 ? `Осталось: ${lessonsWord(left)}.` : left === 0 ? 'Оплаченных уроков: 0.' : `Долг: ${lessonsWord(-left)}.`; }
// Номер серии: время + случайная добавка, чтобы у двух учителей не совпало.
function newSeriesId() { return Date.now() * 1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 1000; }
function randomCode(len) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
function hex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
}
async function webhookSecret(env) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('slotmate:' + env.BOT_TOKEN));
  return hex(hash).slice(0, 48);
}

// Проверка подписи Телеграма: кто открыл приложение.
async function verifyInitData(env, initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = await hmac(new TextEncoder().encode('WebAppData'), env.BOT_TOKEN);
  const check = hex(await hmac(secret, pairs.join('\n')));
  if (check !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 24 * 3600) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
}

// ---------- время (варшавское, вида 2026-11-07 15:00) ----------

const pad = (n) => String(n).padStart(2, '0');
function localParts(date) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function nowLocal(offsetMs = 0) {
  const p = localParts(new Date(Date.now() + offsetMs));
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
function weekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function monday(ymd) { const w = weekday(ymd); return addDays(ymd, w === 0 ? -6 : 1 - w); }
function fmtDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${WD[weekday(ymd)]}, ${d} ${MONTHS[m - 1]}`;
}
function fmt(ts) { return `${fmtDate(ts.slice(0, 10))}, ${ts.slice(11, 16)}`; }
function isTs(ts) { return typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ts); }
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isHm(s) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }
function mins(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }
function localToUtcMs(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const [h, mi] = ts.slice(11, 16).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms) => { const p = localParts(new Date(ms)); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms; };
  let result = guess - offsetAt(guess);
  const second = guess - offsetAt(result);
  if (second !== result) result = second;
  return result;
}

// ---------- проверка накладок ----------

async function findConflict(env, teacherId, ts, dur, excludeId, excludeSeries) {
  const day = ts.slice(0, 10), a = mins(ts.slice(11, 16)), b = a + (dur || 60);
  const { results: ls } = await env.DB.prepare(
    `SELECT l.id, l.starts_at, l.duration_min, l.status, l.proposed_start, u.name AS student_name
     FROM lessons l JOIN students s ON s.id = l.student_id JOIN users u ON u.tg_id = s.tg_id
     WHERE l.teacher_id = ? AND l.status IN ('scheduled', 'pending') AND l.id != ? AND COALESCE(l.series_id, 0) != ? AND (substr(l.starts_at, 1, 10) = ? OR substr(l.proposed_start, 1, 10) = ?)`
  ).bind(teacherId, excludeId || 0, excludeSeries || -1, day, day).all();
  for (const l of ls) {
    if (l.starts_at.slice(0, 10) === day) {
      const x = mins(l.starts_at.slice(11, 16));
      if (a < x + l.duration_min && x < b) return { kind: 'lesson', name: l.student_name, at: l.starts_at.slice(11, 16) };
    }
    if (l.status === 'pending' && l.proposed_start && l.proposed_start.slice(0, 10) === day) {
      const x = mins(l.proposed_start.slice(11, 16));
      if (a < x + l.duration_min && x < b) return { kind: 'proposal', name: l.student_name, at: l.proposed_start.slice(11, 16) };
    }
  }
  const { results: bs } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day = ?').bind(teacherId, day).all();
  for (const x of bs) {
    if (a < mins(x.to_t) && mins(x.from_t) < b) return { kind: 'busy', note: x.note || 'занято', from: x.from_t, to: x.to_t };
  }
  return null;
}

function conflictText(c, forTeacher) {
  if (c.kind === 'busy') {
    const span = c.from === '00:00' && c.to === '23:59' ? 'весь день' : `${c.from}–${c.to}`;
    return forTeacher ? `В это время у вас отмечено: ${c.note} (${span}).` : `Учитель в это время занят: ${c.note} (${span}).`;
  }
  if (!forTeacher) return 'У учителя это время уже занято.';
  if (c.kind === 'lesson') return `В это время уже урок: ${c.name}, ${c.at}.`;
  return `Это время уже предложено другому ученику: ${c.name}, ${c.at}.`;
}

// ---------- Телеграм ----------

async function tg(env, method, payload) {
  // Демо-люди (отрицательные номера) не существуют в Телеграме — им ничего не отправляем.
  if (payload && typeof payload.chat_id === 'number' && payload.chat_id <= DEMO_T) return { ok: true, result: { message_id: 0 } };
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log('Telegram unreachable', method, e && e.message);
    return { ok: false, description: 'network error' };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, description: 'bad response' }; }
  if (!data.ok) console.log('Telegram error', method, data.description);
  return data;
}
function send(env, chatId, msg, markup) {
  const payload = { chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) payload.reply_markup = markup;
  return tg(env, 'sendMessage', payload);
}
function editMsg(env, chatId, msgId, msg, markup) {
  return tg(env, 'editMessageText', {
    chat_id: chatId, message_id: msgId, text: msg, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: markup || { inline_keyboard: [] },
  });
}
function edit(env, cq, msg, markup) { return editMsg(env, cq.message.chat.id, cq.message.message_id, msg, markup); }
async function getBotUsername(env) {
  if (!botUsername) {
    const me = await tg(env, 'getMe', {});
    botUsername = me.ok ? me.result.username : 'Slot_Mate_Bot';
  }
  return botUsername;
}
function appUrl(origin, q) { return `${origin}/app${q ? '?' + q : ''}`; }
function appButton(origin, label = 'Открыть расписание', q) {
  return { inline_keyboard: [[{ text: label, web_app: { url: appUrl(origin, q) } }]] };
}

async function setup(url, env) {
  // Повторная настройка сбрасывает очередь сообщений бота, поэтому после первого раза — только с ключом.
  const done = await env.DB.prepare("SELECT v FROM meta WHERE k = 'origin'").first();
  if (done && !(env.SETUP_KEY && url.searchParams.get('key') === env.SETUP_KEY)) {
    return text('Бот уже подключён. Повторная настройка — только с ключом (секрет SETUP_KEY).', 403);
  }
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('origin', ?)").bind(url.origin).run();
  const r = await tg(env, 'setWebhook', {
    url: `${url.origin}/telegram`, secret_token: await webhookSecret(env),
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Открыть расписание' }, { command: 'help', description: 'Как пользоваться' }] });
  await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Расписание', web_app: { url: `${url.origin}/app` } } });
  return text(r.ok ? 'Готово! Бот подключён. Откройте его в Телеграме и нажмите «Запустить» (Start).'
    : 'Ошибка подключения: ' + (r.description || 'неизвестно') + '. Проверьте секрет BOT_TOKEN.');
}

// ---------- сообщения в чате ----------

async function handleUpdate(update, env, origin) {
  if (update.message) return handleMessage(update.message, env, origin);
  if (update.callback_query) return handleCallback(update.callback_query, env, origin);
}

async function handleMessage(msg, env, origin) {
  if (!msg.from || !msg.chat || msg.chat.type !== 'private') return;
  const user = await upsertUser(env, msg.from);
  const t = (msg.text || '').trim();
  if (t.startsWith('/start')) {
    const payload = t.split(/\s+/)[1] || '';
    if (payload.startsWith('t_')) return acceptTeacherInvite(env, user, payload.slice(2), origin);
    if (payload.startsWith('s_')) return acceptStudentInvite(env, user, payload.slice(2), origin);
  }
  if (t === '/help') {
    return send(env, user.tg_id,
      '<b>Как это работает</b>\nВремя урока меняется только после подтверждения обеих сторон. Пока ответа нет, урок остаётся на старом времени.\n\nВсё расписание — в приложении по кнопке ниже. Когда кто-то предложит перенос, сюда придёт сообщение с кнопками «Подтвердить» и «Не подходит». За сутки до урока придёт напоминание.',
      appButton(origin));
  }
  const student = await isStudentAnywhere(env, user.tg_id);
  const lines = [`Привет, ${esc(user.name)}! Это SlotMate — расписание уроков без путаницы.`];
  if (user.is_teacher) lines.push('Ваше расписание, ученики и оплаты — в приложении по кнопке ниже.');
  else if (student) lines.push('Ваши уроки — в приложении по кнопке ниже. Если учитель предложит перенос, я пришлю сюда кнопки «Подтвердить» и «Не подходит».');
  else if (user.is_admin) lines.push('Вы владелец бота. Откройте приложение и отправьте учителю ссылку-приглашение.');
  else lines.push('Чтобы записаться, попросите у учителя ссылку-приглашение и откройте её.');
  return send(env, user.tg_id, lines.join('\n\n'), appButton(origin));
}

async function acceptTeacherInvite(env, user, code, origin) {
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE code = ? AND kind = 'teacher'").bind(code).first();
  if (!inv) return send(env, user.tg_id, 'Ссылка не найдена. Попросите новую.');
  if (inv.used_by && inv.used_by !== user.tg_id) return send(env, user.tg_id, 'Эта ссылка уже использована. Попросите новую.');
  // Ссылка одноразовая: забираем её одним запросом, чтобы двое не успели одновременно.
  if (!inv.used_by) {
    const took = await env.DB.prepare('UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL').bind(user.tg_id, code).run();
    if (!changed(took)) return send(env, user.tg_id, 'Эта ссылка уже использована. Попросите новую.');
  }
  const inviteCode = user.invite_code || randomCode(10);
  await env.DB.prepare('UPDATE users SET is_teacher = 1, invite_code = ? WHERE tg_id = ?').bind(inviteCode, user.tg_id).run();
  await send(env, user.tg_id, 'Готово, вы учитель! Откройте расписание: на вкладке «Ученики» отправьте ученикам ссылку-приглашение, затем добавляйте уроки.', appButton(origin));
  if (inv.created_by && inv.created_by !== user.tg_id) await send(env, inv.created_by, `Учитель подключился: ${esc(user.name)}.`);
}

async function acceptStudentInvite(env, user, code, origin) {
  const teacher = await env.DB.prepare('SELECT * FROM users WHERE invite_code = ? AND is_teacher = 1').bind(code).first();
  if (!teacher) return send(env, user.tg_id, 'Ссылка не найдена. Попросите у учителя новую.');
  if (teacher.tg_id === user.tg_id) return send(env, user.tg_id, 'Это ваша собственная ссылка для учеников — отправьте её ученикам.', appButton(origin));
  const res = await env.DB.prepare('INSERT INTO students (tg_id, teacher_id, name) VALUES (?, ?, ?) ON CONFLICT(tg_id, teacher_id) DO NOTHING')
    .bind(user.tg_id, teacher.tg_id, user.name).run();
  const isNew = !!(res && res.meta && res.meta.changes > 0);
  await send(env, user.tg_id, isNew
    ? `Готово! Ваш учитель — ${esc(teacher.name)}. Когда появится урок, я пришлю его сюда.`
    : `Вы уже записаны. Ваш учитель — ${esc(teacher.name)}.`, appButton(origin));
  if (isNew) await send(env, teacher.tg_id, `Новый ученик: <b>${esc(user.name)}</b>. Откройте расписание, чтобы назначить урок.`, appButton(origin, 'Назначить урок', `s=${res.meta.last_row_id}&add=1`));
}

async function handleCallback(cq, env, origin) {
  const user = await upsertUser(env, cq.from);
  let note = '';
  try {
    if (cq.message) {
      const p = (cq.data || '').split(':');
      if (p[0] === 'ok' || p[0] === 'no') {
        const r = await answerProposal(env, user, Number(p[1]), p.slice(2).join(':'), p[0] === 'ok', origin, false);
        if (r.msg) await edit(env, cq, r.msg, r.markup);
        note = r.note || r.error || '';
      } else if (p[0] === 'nc') {
        const l = await loadLesson(env, Number(p[1]));
        if (!l || l.teacher_id !== user.tg_id) note = 'Только для учителя';
        else {
          const r = await cancelLesson(env, user, l.id, 'one');
          await edit(env, cq, r.error ? r.error : `Урок ${esc(l.student_name)} <b>${fmt(l.starts_at)}</b> отменён без списания. Ученик получил сообщение.`);
          note = r.error || 'Отменено';
        }
      } else if (p[0] === 'ex') {
        const r = await extendSeries(env, user, Number(p[1]), { auto: true });
        await edit(env, cq, r.error ? r.error : r.msg);
        note = r.error || 'Готово';
      } else if (p[0] === 'nx') {
        await edit(env, cq, 'Хорошо, серия не продлевается. Если передумаете — в приложении откройте любой урок этой серии и нажмите «Продлить».');
        note = 'Не продлеваем';
      } else if (p[0] === 'hd' || p[0] === 'nh') {
        const r = await resolveLesson(env, user, Number(p[1]), p[0] === 'hd');
        await edit(env, cq, r.error || r.msg);
        note = r.error || 'Отмечено';
      } else if (p[0] === 'pd') {
        // pd:<урок>:<сколько уроков>; в старых сообщениях числа нет — тогда абонемент.
        const r = await payForLesson(env, user, Number(p[1]), origin, Number(p[2]) || 0);
        await edit(env, cq, r.error || r.msg);
        note = r.error || 'Оплата записана';
      } else if (p[0] === 'pl') {
        await edit(env, cq, 'Хорошо. Когда ученик оплатит — откройте урок или карточку ученика в приложении и нажмите «Получил оплату».', appButton(origin, 'Открыть урок', `l=${Number(p[1])}`));
        note = 'Пока не оплатил';
      } else if (p[0] === 'ca' || p[0] === 'cr') {
        const r = await answerClaim(env, user, Number(p[1]), p[0] === 'ca', origin, cq);
        note = r.error || r.note || '';
      } else if (p[0] === 'cf' || p[0] === 'cn') {
        note = await reminderAnswer(env, cq, user, Number(p[1]), p[0] === 'cf', origin);
      } else note = 'Эта кнопка устарела';
    }
  } finally {
    const payload = { callback_query_id: cq.id };
    if (note) payload.text = note;
    await tg(env, 'answerCallbackQuery', payload);
  }
}

async function reminderAnswer(env, cq, user, lid, coming, origin) {
  const l = await loadLesson(env, lid);
  if (!l || l.student_tg !== user.tg_id) return 'Урок не найден';
  if (l.status === 'cancelled') { await edit(env, cq, 'Этот урок отменён.'); return ''; }
  if (l.starts_at <= nowLocal()) { await edit(env, cq, `Урок <b>${fmt(l.starts_at)}</b> уже начался — ответить на напоминание нельзя.`); return 'Урок уже начался'; }
  await env.DB.prepare('UPDATE lessons SET reminder_answer = ? WHERE id = ?').bind(coming ? 'yes' : 'no', lid).run();
  if (coming) {
    await edit(env, cq, `Отлично! Урок <b>${fmt(l.starts_at)}</b>, учитель: ${esc(l.teacher_name)}.`);
    return 'Ждём вас';
  }
  await edit(env, cq, `Понял, учитель получил сообщение и сам решит, списывать ли урок. Урок пока стоит: <b>${fmt(l.starts_at)}</b>.\nМожно сразу предложить другое время:`,
    appButton(origin, 'Предложить другое время', `l=${lid}`));
  await send(env, l.teacher_id, `${esc(l.student_name)} не сможет прийти на урок <b>${fmt(l.starts_at)}</b>.`, { inline_keyboard: [
    [{ text: 'Отменить без списания', callback_data: `nc:${lid}` }],
    [{ text: 'Предложить другое время', web_app: { url: appUrl(origin, `l=${lid}`) } }],
  ] });
  return 'Учитель получил сообщение';
}

// ---------- действия (общие для чата и приложения) ----------

function proposalText(l) {
  const toTeacher = l.proposed_by === 's';
  const fromName = toTeacher ? esc(l.student_name) : `Учитель ${esc(l.teacher_name)}`;
  let t = `${fromName} предлагает перенести урок.\nБыло: <s>${fmt(l.starts_at)}</s>\nСтанет: <b>${fmt(l.proposed_start)}</b>`;
  if (l.proposed_scope === 'series') t += `\n\nИ все следующие уроки этой серии: по ${WD_PLURAL[weekday(l.proposed_start.slice(0, 10))]} в ${l.proposed_start.slice(11, 16)}.`;
  return t;
}

async function sendProposal(env, l, origin, prefix) {
  const chat = l.proposed_by === 's' ? l.teacher_id : l.student_tg;
  const r = await send(env, chat, (prefix || '') + proposalText(l), { inline_keyboard: [
    [{ text: 'Подтвердить', callback_data: `ok:${l.id}:${l.proposed_start}` }, { text: 'Не подходит', callback_data: `no:${l.id}:${l.proposed_start}` }],
    [{ text: 'Предложить своё время', web_app: { url: appUrl(origin, `l=${l.id}`) } }],
  ] });
  if (r && r.ok) {
    await env.DB.prepare('UPDATE lessons SET proposal_chat = ?, proposal_msg = ? WHERE id = ?').bind(chat, r.result.message_id, l.id).run();
  }
}

async function closeProposalMsg(env, l, msg) {
  if (l.proposal_chat && l.proposal_msg) await editMsg(env, l.proposal_chat, l.proposal_msg, msg);
}

// Новые даты остальных уроков серии при переносе всей серии.
async function seriesShift(env, l, ts) {
  const delta = daysBetween(l.starts_at.slice(0, 10), ts.slice(0, 10)), hm = ts.slice(11, 16);
  const { results } = await env.DB.prepare(`SELECT id, starts_at FROM lessons WHERE series_id = ? AND id != ? AND starts_at > ? AND status IN ${ACTIVE} ORDER BY starts_at`)
    .bind(l.series_id, l.id, l.starts_at).all();
  return results.map((x) => ({ id: x.id, from: x.starts_at, to: `${addDays(x.starts_at.slice(0, 10), delta)} ${hm}` }));
}
async function seriesClashes(env, l, moves, forTeacher) {
  const out = [];
  for (const m of moves) {
    const c = await findConflict(env, l.teacher_id, m.to, l.duration_min, m.id, l.series_id);
    if (c && c.kind !== 'proposal') out.push({ ...m, why: conflictText(c, forTeacher).replace(/\.$/, '') });
  }
  return out;
}

async function proposeLesson(env, user, lid, ts, scope, origin) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return { error: 'Это не ваш урок' };
  if (l.status === 'cancelled' || l.status === 'late') return { error: 'Этот урок отменён' };
  if (!isTs(ts)) return { error: 'Неверное время' };
  if (ts <= nowLocal()) return { error: 'Это время уже прошло' };
  if (ts === l.starts_at) return { error: 'Это то же самое время' };
  if (l.status === 'pending' && l.proposed_start === ts) return { error: 'Это время уже предложено' };
  const sc = scope === 'series' && l.series_id ? 'series' : 'one';
  // Занятое время предложить нельзя: другая сторона всё равно не смогла бы его подтвердить.
  const c = await findConflict(env, l.teacher_id, ts, l.duration_min, l.id, sc === 'series' ? l.series_id : 0);
  if (c) return { conflict: conflictText(c, r.t) };
  if (sc === 'series') {
    const bad = await seriesClashes(env, l, await seriesShift(env, l, ts), r.t);
    if (bad.length) {
      return { conflict: `Для всей серии не подходит — эти даты заняты:\n${bad.slice(0, 4).map((b) => `${fmt(b.to)} — ${b.why}`).join('\n')}${bad.length > 4 ? `\n…и ещё ${bad.length - 4}` : ''}\n\nМожно перенести только этот урок или выбрать другое время.` };
    }
  }
  const by = r.t ? 't' : 's';
  if (l.status === 'pending') await closeProposalMsg(env, l, `Предложение перенести на ${fmt(l.proposed_start)} заменено новым — смотрите ниже.`);
  await env.DB.prepare("UPDATE lessons SET status = 'pending', proposed_start = ?, proposed_by = ?, proposed_scope = ?, proposed_at = ?, pinged = 0, proposal_chat = NULL, proposal_msg = NULL WHERE id = ?")
    .bind(ts, by, sc, nowLocal(), lid).run();
  await sendProposal(env, { ...l, proposed_start: ts, proposed_by: by, proposed_scope: sc }, origin);
  return { ok: true };
}

async function withdrawProposal(env, user, lid) {
  const l = await loadLesson(env, lid);
  if (!l || l.status !== 'pending') return { error: 'Предложения нет' };
  const r = roles(l, user.tg_id);
  if (!((l.proposed_by === 't' && r.t) || (l.proposed_by === 's' && r.s))) return { error: 'Отозвать может только тот, кто предложил' };
  await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
  await closeProposalMsg(env, l, `Предложение перенести урок отозвано. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`);
  return { ok: true };
}

async function answerProposal(env, user, lid, code, accept, origin, fromApp) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (l.status !== 'pending' || !l.proposed_start || l.proposed_start !== code) {
    return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
  }
  const allowed = (l.proposed_by === 't' && r.s) || (l.proposed_by === 's' && r.t);
  if (!allowed) return { error: 'Ответить должна другая сторона' };
  const proposerChat = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
  const responder = l.proposed_by === 't' ? esc(l.student_name) : `Учитель ${esc(l.teacher_name)}`;
  let msg, markup, note;
  if (accept) {
    let problem = null;
    if (l.proposed_start <= nowLocal()) problem = 'предложенное время уже прошло';
    else {
      const c = await findConflict(env, l.teacher_id, l.proposed_start, l.duration_min, l.id, l.proposed_scope === 'series' ? l.series_id : 0);
      if (c && c.kind !== 'proposal') problem = 'это время уже занято';
    }
    if (problem) {
      await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
      await send(env, proposerChat, `Перенос на ${fmt(l.proposed_start)} не состоялся: ${problem}. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`, appButton(origin, 'Предложить другое время', `l=${lid}`));
      msg = `Не получилось: ${problem}. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`;
      if (fromApp) await closeProposalMsg(env, l, msg);
      return { error: `Не получилось: ${problem}. Предложите другое время.`, msg, markup: appButton(origin, 'Предложить другое время', `l=${lid}`) };
    }
    // Записываем, только если предложение всё ещё то самое, на которое ответили:
    // если другая сторона в эту секунду предложила другое время, ничего не меняем.
    const done = await env.DB.prepare("UPDATE lessons SET starts_at = proposed_start, status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL, reminded = 0, reminder_answer = NULL, pay_asked = 0 WHERE id = ? AND status = 'pending' AND proposed_start = ?").bind(lid, code).run();
    if (!changed(done)) return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
    const stmts = [];
    let extra = '';
    if (l.proposed_scope === 'series' && l.series_id) {
      const hm = l.proposed_start.slice(11, 16);
      const moves = await seriesShift(env, l, l.proposed_start);
      const bad = await seriesClashes(env, l, moves, true);
      const badIds = new Set(bad.map((b) => b.id));
      const ok = moves.filter((m) => !badIds.has(m.id));
      for (const m of ok) {
        stmts.push(env.DB.prepare("UPDATE lessons SET starts_at = ?, status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL, reminded = 0, reminder_answer = NULL WHERE id = ?").bind(m.to, m.id));
      }
      if (ok.length) extra = ` И ещё ${lessonsWord(ok.length)} — по ${WD_PLURAL[weekday(l.proposed_start.slice(0, 10))]} в ${hm}.`;
      if (bad.length) extra += `\nОстались на старом времени (новое уже занято): ${bad.map((b) => fmtDate(b.from.slice(0, 10)) + ' ' + b.from.slice(11, 16)).join(', ')}.`;
    }
    if (stmts.length) await env.DB.batch(stmts);
    await send(env, proposerChat, `${responder} подтверждает перенос. Урок: <b>${fmt(l.proposed_start)}</b>.${extra}`, appButton(origin, 'Открыть урок', `l=${lid}`));
    msg = `Готово! Урок перенесён на <b>${fmt(l.proposed_start)}</b>.${extra}`;
    note = 'Подтверждено';
  } else {
    const done = await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ? AND status = 'pending' AND proposed_start = ?").bind(lid, code).run();
    if (!changed(done)) return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
    await send(env, proposerChat, `${responder}: время ${fmt(l.proposed_start)} не подходит. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>. Если будет встречное предложение, я пришлю его.`, appButton(origin, 'Предложить другое время', `l=${lid}`));
    msg = `Вы ответили «не подходит» на ${fmt(l.proposed_start)}. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>.`;
    markup = appButton(origin, 'Предложить своё время', `l=${lid}`);
    note = 'Ответ отправлен';
  }
  if (fromApp) await closeProposalMsg(env, l, msg);
  return { ok: true, note, msg, markup };
}

async function cancelLesson(env, user, lid, scope) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return { error: 'Это не ваш урок' };
  if (l.status === 'cancelled') return { error: 'Урок уже отменён' };
  if (!r.t && l.starts_at <= nowLocal()) return { error: 'Урок уже начался — отменить его может только учитель' };
  let list = [l];
  if (scope === 'series' && l.series_id) {
    const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.starts_at >= ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`)
      .bind(l.series_id, l.starts_at).all();
    list = results;
  }
  const set = await settingsOf(env, l.teacher_id);
  const lateEdge = nowLocal(set.late_hours * 3600 * 1000);
  const isLate = (x) => !r.t && set.late_hours > 0 && x.starts_at <= lateEdge;
  const stmts = list.map((x) => env.DB.prepare("UPDATE lessons SET status = ?, proposed_start = NULL, proposed_by = NULL WHERE id = ?").bind(isLate(x) ? 'late' : 'cancelled', x.id));
  // «Этот и все следующие» — серия больше не продлевается сама.
  if (scope === 'series' && l.series_id) stmts.push(env.DB.prepare('DELETE FROM series_auto WHERE series_id = ?').bind(l.series_id));
  await env.DB.batch(stmts);
  const lateNote = list.some(isLate) ? `\nПоздняя отмена (меньше чем за ${set.late_hours} ч) — урок списывается по правилу учителя.` : '';
  const freeNote = r.t ? '\nС абонемента не списывается.' : '';
  for (const x of list) if (x.status === 'pending') await closeProposalMsg(env, x, `Урок ${fmt(x.starts_at)} отменён — предложение больше не действует.`);
  const other = r.t ? l.student_tg : l.teacher_id;
  const what = list.length === 1 ? `Урок <b>${fmt(l.starts_at)}</b> отменён.`
    : `Отменены ${lessonsWord(list.length)}: с ${fmtDate(l.starts_at.slice(0, 10))} все по ${WD_PLURAL[weekday(l.starts_at.slice(0, 10))]} в ${l.starts_at.slice(11, 16)}.`;
  if (other !== user.tg_id) await send(env, other, `${what}\nКто отменил: ${esc(user.name)}.${lateNote}${freeNote}`);
  return { ok: true, count: list.length, late: !!lateNote };
}

async function addLesson(env, user, sid, ts, weeks, force, duration, auto) {
  if (!user.is_teacher) return { error: 'Только для учителя' };
  const student = await env.DB.prepare('SELECT s.id, s.tg_id, u.name FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.id = ? AND s.teacher_id = ?').bind(sid, user.tg_id).first();
  if (!student) return { error: 'Ученик не найден' };
  if (!isTs(ts)) return { error: 'Неверное время' };
  if (ts <= nowLocal()) return { error: 'Это время уже прошло' };
  // «Каждую неделю» без срока: ставим 12 недель вперёд, дальше продлевается само.
  const count = auto ? 12 : Math.min(Math.max(Number(weeks) || 1, 1), 52);
  const dur = [30, 45, 60, 90, 120].includes(Number(duration)) ? Number(duration) : (await settingsOf(env, user.tg_id)).default_duration;
  const dates = [];
  for (let i = 0; i < count; i++) dates.push(`${addDays(ts.slice(0, 10), i * 7)} ${ts.slice(11, 16)}`);
  if (!force) {
    const clashes = [];
    for (const d of dates) {
      const c = await findConflict(env, user.tg_id, d, dur, 0);
      if (c) clashes.push(`${fmt(d)} — ${conflictText(c, true).replace(/\.$/, '')}`);
    }
    if (clashes.length) return { conflict: clashes.slice(0, 4).join('\n') + (clashes.length > 4 ? `\n…и ещё ${clashes.length - 4}` : '') };
  }
  const seriesId = count > 1 ? newSeriesId() : null;
  const stmts = dates.map((d) => env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, duration_min) VALUES (?, ?, ?, ?, ?)').bind(user.tg_id, sid, d, seriesId, dur));
  if (auto && seriesId) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(seriesId, user.tg_id));
  await env.DB.batch(stmts);
  const summary = count === 1 ? `<b>${fmt(ts)}</b>`
    : `каждую неделю по ${WD_PLURAL[weekday(ts.slice(0, 10))]} в <b>${ts.slice(11, 16)}</b>, начиная с ${fmtDate(ts.slice(0, 10))} (${auto ? 'без срока' : lessonsWord(count)})`;
  await send(env, student.tg_id, `Учитель ${esc(user.name)}: ${count === 1 ? 'назначен урок' : 'назначены уроки'} — ${summary}.`);
  return { ok: true };
}

// ---------- API для приложения ----------

async function handleApi(request, env, url) {
  const from = await verifyInitData(env, request.headers.get('x-init-data') || '');
  if (!from) return json({ error: 'Откройте приложение из Телеграма' }, 401);
  let user = await upsertUser(env, from);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const path = url.pathname.slice(5);
  if (request.headers.get('x-demo') === '1') {
    if (!user.is_admin) return json({ error: 'Демо доступно только владельцу' }, 403);
    if (path === 'demo/reset' || !(await env.DB.prepare('SELECT 1 FROM users WHERE tg_id = ?').bind(DEMO_T).first())) await seedDemo(env);
    if (path === 'demo/reset') return json({ ok: true });
    if (['invite', 'teacher_invite', 'calendar'].includes(path)) return json({ error: 'В демо это недоступно — здесь нет настоящих учеников' }, 400);
    if (path === 'demo/as_student') {
      const l = await loadLesson(env, Number(body.id));
      if (!l || l.teacher_id !== DEMO_T) return json({ error: 'Урок не найден' }, 400);
      const st = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(l.student_tg).first();
      const r = await answerProposal(env, st, l.id, l.proposed_start, !!body.accept, url.origin, true);
      return r.error ? json({ error: r.error }, 400) : json({ ok: true });
    }
    user = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(DEMO_T).first();
  }
  const origin = url.origin;
  const teacherOnly = () => (user.is_teacher ? null : json({ error: 'Только для учителя' }, 403));
  let r, deny;
  switch (path) {
    case 'me': return json(await meData(env, user, body));
    case 'lesson/add': r = await addLesson(env, user, Number(body.student_id), body.starts_at, body.weeks, !!body.force, body.duration, !!body.auto); break;
    case 'lesson/propose': r = await proposeLesson(env, user, Number(body.id), body.starts_at, body.scope, origin); break;
    case 'lesson/resolve': r = await resolveLesson(env, user, Number(body.id), !!body.held); break;
    case 'lesson/propose_many': {
      const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
      const results = [];
      for (const it of items) {
        const x = await proposeLesson(env, user, Number(it.id), it.starts_at, 'one', origin);
        results.push({ id: Number(it.id), ok: !!x.ok, problem: x.error || x.conflict || null });
      }
      r = { results }; break;
    }
    case 'slots': r = await freeSlots(env, user, body); break;
    case 'lesson/void': {
      const l = await loadLesson(env, Number(body.id));
      if (!l || l.teacher_id !== user.tg_id) return json({ error: 'Только для учителя' }, 403);
      if (l.starts_at > nowLocal() && l.status !== 'late') return json({ error: 'Урок ещё не прошёл — его можно просто отменить' }, 400);
      if (l.status === 'pending') await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} отмечен как несостоявшийся — предложение больше не действует.`);
      await env.DB.prepare("UPDATE lessons SET status = 'cancelled', check_needed = 0, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
      await send(env, l.student_tg, `Урок <b>${fmt(l.starts_at)}</b> отмечен как несостоявшийся — он не списан с абонемента.`);
      r = { ok: true }; break;
    }
    case 'series/extend': r = await extendSeries(env, user, Number(body.series_id), { auto: true }); break;
    case 'lesson/withdraw': r = await withdrawProposal(env, user, Number(body.id)); break;
    case 'lesson/answer': r = await answerProposal(env, user, Number(body.id), body.code, !!body.accept, origin, true); break;
    case 'lesson/cancel': r = await cancelLesson(env, user, Number(body.id), body.scope); break;
    case 'busy/add': {
      if ((deny = teacherOnly())) return deny;
      const allDay = !!body.all_day;
      const f = allDay ? '00:00' : body.from, t = allDay ? '23:59' : body.to;
      if (!isYmd(body.date) || !isHm(f) || !isHm(t) || mins(t) <= mins(f)) return json({ error: 'Проверьте дату и время' }, 400);
      if (body.date < nowLocal().slice(0, 10)) return json({ error: 'Этот день уже прошёл' }, 400);
      const note = String(body.note || 'Концерт').slice(0, 60);
      await env.DB.prepare('INSERT INTO busy (teacher_id, day, from_t, to_t, note) VALUES (?, ?, ?, ?, ?)').bind(user.tg_id, body.date, f, t, note).run();
      const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.teacher_id = ? AND substr(l.starts_at, 1, 10) = ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`)
        .bind(user.tg_id, body.date).all();
      const affected = results.filter((l) => { const x = mins(l.starts_at.slice(11, 16)); return x < mins(t) && mins(f) < x + l.duration_min; })
        .map((l) => ({ id: l.id, starts_at: l.starts_at, student_name: l.student_name, status: l.status }));
      r = { ok: true, affected }; break;
    }
    case 'busy/remove': {
      if ((deny = teacherOnly())) return deny;
      await env.DB.prepare('DELETE FROM busy WHERE id = ? AND teacher_id = ?').bind(Number(body.id), user.tg_id).run();
      r = { ok: true }; break;
    }
    case 'student/remove': {
      if ((deny = teacherOnly())) return deny;
      const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(Number(body.id), user.tg_id).first();
      if (!st) return json({ error: 'Ученик не найден' }, 400);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM series_auto WHERE series_id IN (SELECT DISTINCT series_id FROM lessons WHERE student_id = ? AND series_id IS NOT NULL)').bind(st.id),
        env.DB.prepare("UPDATE lessons SET status = 'cancelled' WHERE student_id = ? AND starts_at >= ?").bind(st.id, nowLocal()),
        env.DB.prepare('DELETE FROM students WHERE id = ?').bind(st.id),
      ]);
      await send(env, st.tg_id, `Учитель ${esc(user.name)}: вы больше не в списке учеников, будущие уроки отменены.`);
      r = { ok: true }; break;
    }
    case 'settings': {
      if ((deny = teacherOnly())) return deny;
      const size = Math.min(Math.max(Number(body.pack_size) || 4, 1), 100), price = Math.min(Math.max(Number(body.pack_price) || 0, 0), 100000);
      const dur = [30, 45, 60, 90, 120].includes(Number(body.default_duration)) ? Number(body.default_duration) : 60;
      const late = [0, 6, 12, 24, 48].includes(Number(body.late_hours)) ? Number(body.late_hours) : 0;
      await env.DB.prepare('INSERT INTO teacher_settings (teacher_id, pack_size, pack_price, default_duration, late_hours) VALUES (?, ?, ?, ?, ?) ON CONFLICT(teacher_id) DO UPDATE SET pack_size = excluded.pack_size, pack_price = excluded.pack_price, default_duration = excluded.default_duration, late_hours = excluded.late_hours')
        .bind(user.tg_id, size, price, dur, late).run();
      r = { ok: true }; break;
    }
    case 'pay/add': {
      if ((deny = teacherOnly())) return deny;
      const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(Number(body.student_id), user.tg_id).first();
      if (!st) return json({ error: 'Ученик не найден' }, 400);
      if (!(Number(body.lessons) >= 1)) return json({ error: 'Укажите, сколько уроков оплачено' }, 400);
      const id = await recordPayment(env, user, st, body.lessons, body.amount, body.kind === 'initial' ? 'initial' : 'pay', origin);
      r = { ok: true, id }; break;
    }
    case 'pay/lesson': r = await payForLesson(env, user, Number(body.id), origin); break;
    case 'pay/claim': r = await claimPayment(env, user, Number(body.sub_id), body.lessons, body.amount, origin); break;
    case 'pay/claim_answer': r = await answerClaim(env, user, Number(body.id), !!body.ok, origin); break;
    case 'pay/undo': {
      if ((deny = teacherOnly())) return deny;
      const p = await env.DB.prepare('SELECT p.*, s.tg_id FROM payments p JOIN students s ON s.id = p.student_id WHERE p.id = ? AND p.teacher_id = ?').bind(Number(body.id), user.tg_id).first();
      if (!p) return json({ error: 'Оплата не найдена' }, 400);
      await env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(p.id).run();
      if (p.kind !== 'initial') await send(env, p.tg_id, `Отметка об оплате (${lessonsWord(p.lessons)}) отменена учителем — это была ошибка.`);
      r = { ok: true }; break;
    }
    case 'pay/remind': {
      if ((deny = teacherOnly())) return deny;
      const ids = Array.isArray(body.student_ids) ? body.student_ids.map(Number) : [Number(body.student_id)];
      const set = await settingsOf(env, user.tg_id);
      let sent = 0;
      for (const id of ids.slice(0, 50)) {
        const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(id, user.tg_id).first();
        if (!st) continue;
        const b = await balanceOf(env, st.id);
        if (b.left > 0) continue;
        const price = set.pack_price ? ` Абонемент: ${lessonsWord(set.pack_size)} — ${set.pack_price} zł.` : '';
        await send(env, st.tg_id, `Напоминание об оплате: ${!b.paid && !b.used ? 'оплаты за уроки ещё не было' : 'оплаченные уроки закончились'}${b.left < 0 ? ` (в долг: ${lessonsWord(-b.left)})` : ''}.${price} Учитель: ${esc(user.name)}.`);
        sent++;
      }
      r = { ok: true, sent }; break;
    }
    case 'invite': {
      if ((deny = teacherOnly())) return deny;
      let code = user.invite_code;
      if (!code) { code = randomCode(10); await env.DB.prepare('UPDATE users SET invite_code = ? WHERE tg_id = ?').bind(code, user.tg_id).run(); }
      r = { link: `https://t.me/${await getBotUsername(env)}?start=s_${code}` }; break;
    }
    case 'teacher_invite': {
      if (!user.is_admin) return json({ error: 'Только для владельца' }, 403);
      const code = randomCode(12);
      await env.DB.prepare('INSERT INTO invites (code, kind, created_by) VALUES (?, ?, ?)').bind(code, 'teacher', user.tg_id).run();
      r = { link: `https://t.me/${await getBotUsername(env)}?start=t_${code}` }; break;
    }
    case 'calendar': {
      let key = user.cal_key;
      if (!key) { key = randomCode(24); await env.DB.prepare('UPDATE users SET cal_key = ? WHERE tg_id = ?').bind(key, user.tg_id).run(); }
      r = { link: `${origin}/cal/${key}.ics` }; break;
    }
    default: return json({ error: 'not found' }, 404);
  }
  if (r.error) return json({ error: r.error }, 400);
  return json(r);
}

async function meData(env, user, body) {
  const now = nowLocal(), today = now.slice(0, 10);
  const isStudent = await isStudentAnywhere(env, user.tg_id);
  const from = isYmd(body.week) ? body.week : monday(today);
  let to = addDays(from, 7);
  if (to < addDays(today, 60)) to = addDays(today, 60);
  const lo = from < today ? from : today;
  const { results } = await env.DB.prepare(
    `${LESSON_SELECT} WHERE (l.teacher_id = ? OR s.tg_id = ?) AND l.status IN ('scheduled', 'pending', 'late') AND l.starts_at >= ? AND l.starts_at < ? ORDER BY l.starts_at LIMIT 500`
  ).bind(user.tg_id, user.tg_id, `${lo} 00:00`, `${to} 00:00`).all();
  const teacherIds = [...new Set(results.map((l) => l.teacher_id))];
  const busyAll = [];
  for (const tid of teacherIds) {
    const { results: b } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(tid, lo, to).all();
    busyAll.push(...b);
  }
  const seriesIds = [...new Set(results.filter((l) => l.series_id).map((l) => l.series_id))];
  const seriesDates = {}, autoSeries = new Set();
  if (seriesIds.length) {
    const qs = seriesIds.map(() => '?').join(',');
    const { results: sr } = await env.DB.prepare(`SELECT series_id, starts_at FROM lessons WHERE series_id IN (${qs}) AND status IN ${ACTIVE} AND starts_at >= ? ORDER BY starts_at`).bind(...seriesIds, now).all();
    for (const x of sr) (seriesDates[x.series_id] = seriesDates[x.series_id] || []).push(x.starts_at);
    const { results: au } = await env.DB.prepare(`SELECT series_id FROM series_auto WHERE series_id IN (${qs})`).bind(...seriesIds).all();
    for (const x of au) autoSeries.add(x.series_id);
  }
  const lateSet = {};
  for (const tid of teacherIds) lateSet[tid] = (await settingsOf(env, tid)).late_hours;
  const lessons = results.map((l) => {
    const day = l.starts_at.slice(0, 10), x = mins(l.starts_at.slice(11, 16));
    const clash = l.status === 'late' ? null : busyAll.find((b) => b.teacher_id === l.teacher_id && b.day === day && x < mins(b.to_t) && mins(b.from_t) < x + l.duration_min);
    const sd = l.series_id ? seriesDates[l.series_id] || [] : [];
    const later = sd.filter((d) => d > l.starts_at).length;
    const lh = lateSet[l.teacher_id] || 0;
    return {
      id: l.id, teacher_id: l.teacher_id, starts_at: l.starts_at, status: l.status, proposed_start: l.proposed_start, proposed_by: l.proposed_by,
      proposed_scope: l.proposed_scope, series: !!l.series_id, later, student_id: l.student_id, student_name: l.student_name, teacher_name: l.teacher_name,
      is_mine: l.student_tg === user.tg_id, is_teaching: l.teacher_id === user.tg_id, past: l.starts_at < now,
      clash: clash ? `${clash.note || 'занято'}${clash.from_t === '00:00' && clash.to_t === '23:59' ? '' : ` ${clash.from_t}–${clash.to_t}`}` : null,
      reminder_answer: l.reminder_answer || null, duration: l.duration_min, series_id: l.series_id || null,
      series_end: sd.length ? sd[sd.length - 1] : null, series_auto: autoSeries.has(l.series_id), check_needed: !!l.check_needed,
      late_charge: lh > 0 && l.starts_at > now && l.starts_at <= nowLocal(lh * 3600 * 1000), late_hours: lh,
    };
  });
  const out = { name: user.name, is_admin: !!user.is_admin, is_teacher: !!user.is_teacher, is_student: isStudent, today, now, lessons, students: [], busy: [], settings: null, month: null, my_subs: [] };
  if (user.is_teacher) {
    const set = await settingsOf(env, user.tg_id);
    out.settings = set;
    const { results: st } = await env.DB.prepare(
      `SELECT s.id, u.name,
        (SELECT MIN(starts_at) FROM lessons l WHERE l.student_id = s.id AND l.status IN ('scheduled', 'pending') AND l.starts_at >= ?) AS next,
        (SELECT MIN(starts_at) FROM lessons l WHERE l.student_id = s.id AND l.status IN ('scheduled', 'pending', 'late') AND substr(l.starts_at, 1, 10) = ?) AS today_at,
        (SELECT COALESCE(SUM(lessons), 0) FROM payments p WHERE p.student_id = s.id) AS paid,
        (SELECT COUNT(*) FROM lessons l WHERE l.student_id = s.id AND ${USED} AND l.starts_at < ?) AS used
       FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.teacher_id = ? ORDER BY u.name`
    ).bind(now, today, now, user.tg_id).all();
    out.students = st.map((s) => ({ ...s, paid: Number(s.paid), used: Number(s.used), left: Number(s.paid) - Number(s.used) }));
    const { results: own } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(user.tg_id, lo, to).all();
    out.busy = own.map((b) => ({ id: b.id, day: b.day, from_t: b.from_t, to_t: b.to_t, note: b.note }));
    const monthStart = `${today.slice(0, 7)}-01`;
    const m = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS got, COUNT(*) AS n FROM payments WHERE teacher_id = ? AND created_at >= ?').bind(user.tg_id, monthStart).first();
    // Ждём оплату: уроки закончились — или оплат ещё не было, а урок уже назначен
    // (если учитель ведёт оплаты в приложении: указал цену или уже вносил оплату).
    const usesPay = !!(set.pack_price || (await env.DB.prepare('SELECT 1 FROM payments WHERE teacher_id = ? LIMIT 1').bind(user.tg_id).first()));
    for (const s of out.students) s.due = s.left <= 0 && !!(s.paid || s.used || (usesPay && s.next));
    const due = out.students.filter((s) => s.due).length;
    out.month = { got: Number(m.got), due_count: due, due_sum: due * set.pack_price };
    const { results: pays } = await env.DB.prepare(
      `SELECT p.id, p.student_id, p.lessons, p.amount, p.kind, p.created_at, u.name FROM payments p JOIN students s ON s.id = p.student_id JOIN users u ON u.tg_id = s.tg_id
       WHERE p.teacher_id = ? ORDER BY p.id DESC LIMIT 100`).bind(user.tg_id).all();
    out.payments = pays;
    // Прошедшие уроки с открытым вопросом: учитель решает, списывать ли.
    const { results: chk } = await env.DB.prepare(
      `${LESSON_SELECT} WHERE l.teacher_id = ? AND l.starts_at < ? AND (l.check_needed = 1 OR l.status = 'pending' OR (l.status = 'scheduled' AND l.reminder_answer = 'no')) ORDER BY l.starts_at DESC LIMIT 30`
    ).bind(user.tg_id, now).all();
    out.to_check = chk.map((l) => ({ id: l.id, starts_at: l.starts_at, student_name: l.student_name, why: l.reminder_answer === 'no' ? 'no' : 'move' }));
    // Ученики нажали «Я оплатил» — ждут ответа учителя.
    const { results: cl } = await env.DB.prepare(
      `SELECT c.id, c.student_id, c.lessons, c.amount, u.name FROM pay_claims c JOIN students s ON s.id = c.student_id JOIN users u ON u.tg_id = s.tg_id
       WHERE c.teacher_id = ? AND c.status = 'open' ORDER BY c.id`).bind(user.tg_id).all();
    out.claims = cl;
    out.uses_pay = !!(set.pack_price || pays.length);
  }
  if (isStudent) {
    const { results: subs } = await env.DB.prepare(
      `SELECT s.id, s.teacher_id, u.name AS teacher_name,
        (SELECT lessons || ':' || amount FROM pay_claims c WHERE c.student_id = s.id AND c.status = 'open' LIMIT 1) AS claim,
        (SELECT COALESCE(SUM(lessons), 0) FROM payments p WHERE p.student_id = s.id) AS paid,
        (SELECT COUNT(*) FROM lessons l WHERE l.student_id = s.id AND ${USED} AND l.starts_at < ?) AS used
       FROM students s JOIN users u ON u.tg_id = s.teacher_id WHERE s.tg_id = ?`
    ).bind(now, user.tg_id).all();
    for (const s of subs) {
      const set = await settingsOf(env, s.teacher_id);
      const claim = s.claim ? { lessons: Number(s.claim.split(':')[0]), amount: Number(s.claim.split(':')[1]) } : null;
      out.my_subs.push({ id: s.id, teacher_id: s.teacher_id, teacher_name: s.teacher_name, paid: Number(s.paid), used: Number(s.used), left: Number(s.paid) - Number(s.used), pack_size: set.pack_size, pack_price: set.pack_price, late_hours: set.late_hours, claim });
    }
  }
  markPaidLessons(out);
  return out;
}

// ---------- оплаты ----------

// Записать оплату и сообщить ученику. st — строка students (id, tg_id).
async function recordPayment(env, teacher, st, lessons, amount, kind, origin) {
  const n = Math.min(Math.max(Math.round(Number(lessons) || 0), 1), 100), sum = kind === 'initial' ? 0 : Math.max(Math.round(Number(amount) || 0), 0);
  const res = await env.DB.prepare('INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, ?, ?)').bind(teacher.tg_id, st.id, n, sum, kind).run();
  if (kind !== 'initial') {
    const b = await balanceOf(env, st.id);
    await send(env, st.tg_id, `Учитель ${esc(teacher.name)} отметил оплату: ${lessonsWord(n)}${sum ? ` (${sum} zł)` : ''}. ${balanceLine(b.left)}`, appButton(origin, 'Мои уроки'));
  }
  return res && res.meta ? res.meta.last_row_id : null;
}

// Оплачен ли урок: хватает ли остатка абонемента с учётом уроков, которые будут раньше этого.
async function lessonCovered(env, l) {
  const now = nowLocal(), b = await balanceOf(env, l.student_id);
  if (l.starts_at <= now) return b.left >= 0;
  const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lessons WHERE student_id = ? AND status IN ${ACTIVE} AND starts_at > ? AND starts_at < ?`).bind(l.student_id, now, l.starts_at).first();
  return b.left - Number(before.n) >= 1;
}

function packText(set) { return `${lessonsWord(set.pack_size)}${set.pack_price ? ` · ${set.pack_price} zł` : ''}`; }
// Сумма за n уроков по цене абонемента: 4 за 600 → 1 урок 150, 8 уроков 1200 (так же считает экран).
function priceFor(set, n) {
  if (!set.pack_price || !(n >= 1)) return 0;
  const k = n / set.pack_size;
  return Number.isInteger(k) ? set.pack_price * k : Math.round((n * set.pack_price) / set.pack_size);
}
// Варианты для кнопок: 1 урок, абонемент, два абонемента.
function payPresets(set) {
  const p = set.pack_size || 4, a = p === 1 ? [1, 4, 8] : [1, p, 2 * p];
  return a.filter((x, i) => a.indexOf(x) === i);
}
function payText(set, n) { const sum = priceFor(set, n); return `${lessonsWord(n)}${sum ? ` · ${sum} zł` : ''}`; }

// «Получил оплату» кнопкой в сообщении бота: за сколько уроков — выбрал учитель, сумма по цене урока.
async function payForLesson(env, user, lid, origin, lessons = 0) {
  const l = await loadLesson(env, lid);
  if (!l || l.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  if (await lessonCovered(env, l)) return { error: 'Этот урок уже оплачен' };
  const took = await env.DB.prepare('UPDATE lessons SET pay_asked = 2 WHERE id = ? AND pay_asked != 2').bind(lid).run();
  if (!changed(took)) return { error: 'Оплата по этому уроку уже записана' };
  const set = await settingsOf(env, l.teacher_id);
  const n = Math.min(Math.max(Math.round(lessons) || set.pack_size, 1), 100);
  const id = await recordPayment(env, user, { id: l.student_id, tg_id: l.student_tg }, n, priceFor(set, n), 'pay', origin);
  return { ok: true, id, msg: `Записано: ${esc(l.student_name)}, ${payText(set, n)}. Ученик получил подтверждение. Ошиблись — «Все оплаты» в приложении → «Отменить».` };
}

// Ученик нажал «Я оплатил»: абонемент засчитается, только когда учитель подтвердит.
async function claimPayment(env, user, subId, lessons, amount, origin) {
  const st = await env.DB.prepare('SELECT s.*, u.name AS teacher_name FROM students s JOIN users u ON u.tg_id = s.teacher_id WHERE s.id = ? AND s.tg_id = ?').bind(subId, user.tg_id).first();
  if (!st) return { error: 'Учитель не найден' };
  if (await env.DB.prepare("SELECT 1 FROM pay_claims WHERE student_id = ? AND status = 'open'").bind(st.id).first()) return { error: 'Уже отправлено — ждём, что ответит учитель' };
  const set = await settingsOf(env, st.teacher_id);
  const n = Math.min(Math.max(Math.round(Number(lessons) || set.pack_size), 1), 100), sum = Math.max(Math.round(Number(amount) || 0), 0);
  const res = await env.DB.prepare('INSERT INTO pay_claims (teacher_id, student_id, lessons, amount) VALUES (?, ?, ?, ?)').bind(st.teacher_id, st.id, n, sum).run();
  const cid = res.meta.last_row_id;
  const m = await send(env, st.teacher_id, `${esc(user.name)} пишет, что оплатил: <b>${lessonsWord(n)}${sum ? ` · ${sum} zł` : ''}</b>. Деньги получили?`, { inline_keyboard: [
    [{ text: 'Получил', callback_data: `ca:${cid}` }, { text: 'Не получал', callback_data: `cr:${cid}` }],
  ] });
  if (m && m.ok) await env.DB.prepare('UPDATE pay_claims SET msg_chat = ?, msg_id = ? WHERE id = ?').bind(st.teacher_id, m.result.message_id, cid).run();
  return { ok: true };
}

async function answerClaim(env, user, cid, ok, origin, cq) {
  const c = await env.DB.prepare('SELECT c.*, s.tg_id AS student_tg, u.name AS student_name FROM pay_claims c JOIN students s ON s.id = c.student_id JOIN users u ON u.tg_id = s.tg_id WHERE c.id = ?').bind(cid).first();
  if (!c || c.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  const what = `${lessonsWord(c.lessons)}${c.amount ? ` · ${c.amount} zł` : ''}`;
  const took = await env.DB.prepare("UPDATE pay_claims SET status = ? WHERE id = ? AND status = 'open'").bind(ok ? 'ok' : 'no', cid).run();
  if (!changed(took)) {
    if (cq) await edit(env, cq, `${esc(c.student_name)}: ${what} — уже отвечено.`);
    return { error: 'Уже отвечено' };
  }
  let msg;
  if (ok) {
    await recordPayment(env, user, { id: c.student_id, tg_id: c.student_tg }, c.lessons, c.amount, 'pay', origin);
    msg = `Оплата записана: ${esc(c.student_name)}, ${what}. Ученик получил подтверждение.`;
  } else {
    await send(env, c.student_tg, `Учитель ${esc(user.name)} пока не видит вашу оплату (${what}). Если это ошибка — напишите учителю.`);
    msg = `${esc(c.student_name)}: ${what} — отмечено «не получал». Ученик получил сообщение.`;
  }
  if (cq) await edit(env, cq, msg);
  else if (c.msg_chat && c.msg_id) await editMsg(env, c.msg_chat, c.msg_id, msg);
  return { ok: true, note: ok ? 'Оплата записана' : 'Ответ отправлен' };
}

// Какие будущие уроки уже оплачены: остаток абонемента «раскладываем» по ближайшим урокам.
// paid_ok — урок оплачен; pay_due — первый неоплаченный (тут учитель ждёт деньги).
function markPaidLessons(out) {
  const left = {};
  for (const s of out.students) left[s.id] = s.left;
  for (const s of out.my_subs) left[s.id] = s.left;
  const usesPay = (l) => (l.is_teaching ? out.uses_pay : !!out.my_subs.find((x) => x.id === l.student_id && (x.paid || x.pack_price)));
  const idx = {}, until = {};
  for (const l of out.lessons) {
    if (l.past || !['scheduled', 'pending'].includes(l.status) || !(l.student_id in left) || !usesPay(l)) continue;
    const i = idx[l.student_id] = (idx[l.student_id] || 0) + 1;
    l.paid_ok = i <= left[l.student_id];
    l.pay_due = i === Math.max(left[l.student_id], 0) + 1;
    if (l.paid_ok) until[l.student_id] = l.starts_at;
  }
  for (const s of out.my_subs) s.paid_until = until[s.id] || null;
}

// ---------- демо ----------

async function seedDemo(env) {
  const ids = DEMO_STUDENTS.map((_, i) => DEMO_T - 1 - i);
  const wipe = [
    env.DB.prepare('DELETE FROM lessons WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM payments WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM pay_claims WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM series_auto WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM busy WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM students WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM teacher_settings WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM users WHERE tg_id <= ? AND tg_id >= ?').bind(DEMO_T, DEMO_T - 50),
    env.DB.prepare('INSERT INTO users (tg_id, name, is_teacher) VALUES (?, ?, 1)').bind(DEMO_T, 'Павел (демо)'),
    env.DB.prepare('INSERT INTO teacher_settings (teacher_id, pack_size, pack_price, default_duration, late_hours) VALUES (?, 4, 600, 60, 0)').bind(DEMO_T),
  ];
  DEMO_STUDENTS.forEach(([name], i) => {
    wipe.push(env.DB.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').bind(ids[i], name));
    wipe.push(env.DB.prepare('INSERT INTO students (tg_id, teacher_id, name) VALUES (?, ?, ?)').bind(ids[i], DEMO_T, name));
  });
  await env.DB.batch(wipe);
  const now = nowLocal(), mon = monday(now.slice(0, 10));
  const stmts = [];
  for (let i = 0; i < DEMO_STUDENTS.length; i++) {
    const [, wd, hm, paid] = DEMO_STUDENTS[i];
    const st = await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first();
    const series = Date.now() * 10 + i;
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(series, DEMO_T));
    for (let k = 0; k < 10; k++) {
      stmts.push(env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, reminded) VALUES (?, ?, ?, ?, 1)')
        .bind(DEMO_T, st.id, `${addDays(mon, wd - 14 + k * 7)} ${hm}`, series));
    }
    if (paid > 0) stmts.push(env.DB.prepare("INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, ?, 'pay')").bind(DEMO_T, st.id, paid, paid / 4 * 600));
    if (paid < 0) stmts.push(env.DB.prepare("INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, 0, 'initial')").bind(DEMO_T, st.id, -paid));
  }
  await env.DB.batch(stmts);
  const next = async (i) => {
    const st = await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first();
    return env.DB.prepare("SELECT * FROM lessons WHERE student_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 1").bind(st.id, now).first();
  };
  const sidOf = async (i) => (await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first()).id;
  // Кася просит перенести ближайший урок на день позже
  const k = await next(2);
  await env.DB.prepare("UPDATE lessons SET status = 'pending', proposed_start = ?, proposed_by = 's', proposed_scope = 'one', proposed_at = ? WHERE id = ?")
    .bind(`${addDays(k.starts_at.slice(0, 10), 1)} ${k.starts_at.slice(11, 16)}`, now, k.id).run();
  // Марек ответил на напоминание «не смогу»
  const m = await next(1);
  await env.DB.prepare("UPDATE lessons SET reminder_answer = 'no' WHERE id = ?").bind(m.id).run();
  // Прошедший урок Олы с открытым вопросом
  const o = await env.DB.prepare("SELECT id FROM lessons WHERE student_id = ? AND starts_at < ? ORDER BY starts_at DESC LIMIT 1").bind(await sidOf(0), now).first();
  if (o) await env.DB.prepare("UPDATE lessons SET reminder_answer = 'no', check_needed = 1 WHERE id = ?").bind(o.id).run();
  // Концерт в день ближайшего урока Томека
  const t = await next(3);
  await env.DB.prepare("INSERT INTO busy (teacher_id, day, from_t, to_t, note) VALUES (?, ?, '17:00', '23:00', 'Концерт')").bind(DEMO_T, t.starts_at.slice(0, 10)).run();
}

// ---------- свободные окна ----------

async function freeSlots(env, user, body) {
  let teacherId, dur = 60, base = null, exclude = 0;
  if (body.lesson_id) {
    const l = await loadLesson(env, Number(body.lesson_id));
    if (!l) return { error: 'Урок не найден' };
    const r = roles(l, user.tg_id);
    if (!r.t && !r.s) return { error: 'Это не ваш урок' };
    teacherId = l.teacher_id; dur = l.duration_min; base = l.starts_at; exclude = l.id;
  } else {
    if (!user.is_teacher) return { error: 'Только для учителя' };
    teacherId = user.tg_id; dur = Number(body.duration) || 60; base = isTs(body.around) ? body.around : null;
  }
  const now = nowLocal(), today = now.slice(0, 10);
  if (!base || base < now) base = `${addDays(today, 1)} ${base ? base.slice(11, 16) : '15:00'}`;
  const baseDay = base.slice(0, 10), baseHm = base.slice(11, 16);
  const from = addDays(baseDay, -3) < today ? today : addDays(baseDay, -3), to = addDays(baseDay, 15);
  const { results: ls } = await env.DB.prepare(`SELECT id, starts_at, duration_min, status, proposed_start FROM lessons WHERE teacher_id = ? AND status IN ${ACTIVE} AND ((starts_at >= ? AND starts_at < ?) OR (proposed_start >= ? AND proposed_start < ?))`)
    .bind(teacherId, `${from} 00:00`, `${to} 00:00`, `${from} 00:00`, `${to} 00:00`).all();
  const { results: bs } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(teacherId, from, to).all();
  const taken = [];
  for (const l of ls) {
    if (l.id === exclude) continue;
    taken.push([l.starts_at.slice(0, 10), mins(l.starts_at.slice(11, 16)), l.duration_min]);
    if (l.status === 'pending' && l.proposed_start) taken.push([l.proposed_start.slice(0, 10), mins(l.proposed_start.slice(11, 16)), l.duration_min]);
  }
  for (const b of bs) taken.push([b.day, mins(b.from_t), mins(b.to_t) - mins(b.from_t)]);
  const free = (day, m) => !taken.some(([d, a, len]) => d === day && m < a + len && a < m + dur);
  const usual = new Set([mins(baseHm)]);
  for (const l of ls) usual.add(mins(l.starts_at.slice(11, 16)));
  const cands = [];
  for (let dd = -3; dd <= 14; dd++) {
    const day = addDays(baseDay, dd);
    if (day < today) continue;
    for (let m = 9 * 60; m <= 21 * 60; m += 30) {
      const ts = `${day} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      if (ts <= now || ts === base || !free(day, m)) continue;
      const score = Math.abs(dd) * 30 + Math.abs(m - mins(baseHm)) / 30 * 12 + (usual.has(m) ? 0 : 15) + (dd < 0 ? 20 : 0);
      cands.push({ ts, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // Выбираем самые близкие к обычному времени, а показываем по порядку дат.
  const top = cands.slice(0, Number(body.limit) || 6).map((c) => c.ts);
  return { slots: top.slice().sort(), best: top[0] || null };
}

// Продлить серию на 12 недель. auto — дальше продлевать самим (без вопросов);
// system — вызов из ежечасной задачи (ученику не пишем, учителю — только если недели пропущены).
async function extendSeries(env, user, seriesId, opts = {}) {
  const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.status IN ${ACTIVE} ORDER BY l.starts_at DESC LIMIT 1`).bind(seriesId).all();
  const last = results[0];
  if (!last || (!opts.system && last.teacher_id !== user.tg_id)) return { error: 'Серия не найдена' };
  if (opts.auto) await env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(seriesId, last.teacher_id).run();
  const hm = last.starts_at.slice(11, 16), wdName = WD_PLURAL[weekday(last.starts_at.slice(0, 10))];
  // Уже запланировано больше чем на 8 недель вперёд — добавлять рано (и повторное нажатие ничего не удвоит).
  if (last.starts_at > nowLocal(56 * 24 * 3600 * 1000)) {
    return { ok: true, added: 0, skipped: [], msg: opts.auto
      ? `Готово: уроки ${esc(last.student_name)} по ${wdName} в ${hm} будут продлеваться сами. Остановить — «Отменить урок → этот и все следующие».`
      : `Уроки уже запланированы до ${fmtDate(last.starts_at.slice(0, 10))}.` };
  }
  const dates = [], skipped = [];
  for (let i = 1; i <= 12; i++) {
    const d = `${addDays(last.starts_at.slice(0, 10), i * 7)} ${hm}`;
    const c = await findConflict(env, last.teacher_id, d, last.duration_min, 0);
    if (c) skipped.push(`${fmtDate(d.slice(0, 10))} — ${esc(conflictText(c, true).replace(/\.$/, ''))}`); else dates.push(d);
  }
  if (!dates.length) return { error: 'Все 12 следующих недель в это время заняты. Добавьте уроки на другое время.' };
  await env.DB.batch(dates.map((d) => env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, duration_min) VALUES (?, ?, ?, ?, ?)').bind(last.teacher_id, last.student_id, d, seriesId, last.duration_min)));
  const until = fmtDate(dates[dates.length - 1].slice(0, 10));
  const skipNote = skipped.length ? `\nПропущены (время занято): ${skipped.map((x) => x.split(' — ')[0]).join(', ')}.` : '';
  const skipList = skipped.length ? `\nПропущены, потому что время занято:\n${skipped.join('\n')}` : '';
  if (opts.system) {
    if (skipped.length) await send(env, last.teacher_id, `Регулярные уроки ${esc(last.student_name)} продлены до ${until}.${skipList}`);
  } else {
    await send(env, last.student_tg, `Учитель ${esc(last.teacher_name)}: уроки продлены — по ${wdName} в ${hm}${opts.auto ? ', без срока' : `, до ${until}`}.${skipNote}`);
  }
  const head = opts.auto ? `Готово: уроки ${esc(last.student_name)} по ${wdName} в ${hm} будут продлеваться сами.` : `Продлено: ${esc(last.student_name)}, по ${wdName} в ${hm}, до ${until} (${lessonsWord(dates.length)}).`;
  return { ok: true, added: dates.length, skipped, msg: head + skipList };
}

// Учитель решает, состоялся ли прошедший урок, по которому был открытый вопрос.
async function resolveLesson(env, user, lid, held) {
  const l = await loadLesson(env, lid);
  if (!l || l.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  if (l.starts_at > nowLocal()) return { error: 'Урок ещё не прошёл' };
  if (l.status === 'cancelled') return { msg: `Урок ${esc(l.student_name)} ${fmt(l.starts_at)} уже отмечен как несостоявшийся.` };
  if (l.status === 'pending') await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} уже прошёл — предложение перенести больше не действует.`);
  if (held) {
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', check_needed = 0, reminder_answer = 'held', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
    return { ok: true, msg: `Отмечено: урок ${esc(l.student_name)} ${fmt(l.starts_at)} состоялся и списан с абонемента.` };
  }
  await env.DB.prepare("UPDATE lessons SET status = 'cancelled', check_needed = 0, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
  await send(env, l.student_tg, `Урок <b>${fmt(l.starts_at)}</b> не состоялся — с абонемента не списан.`);
  return { ok: true, msg: `Отмечено: урок ${esc(l.student_name)} ${fmt(l.starts_at)} не состоялся, не списан.` };
}

// ---------- календарь ----------

async function calendarFeed(url, env) {
  const m = url.pathname.match(/^\/cal\/([A-Za-z0-9]+)\.ics$/);
  if (!m) return text('not found', 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE cal_key = ?').bind(m[1]).first();
  if (!user) return text('not found', 404);
  const since = `${addDays(nowLocal().slice(0, 10), -60)} 00:00`;
  const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE (l.teacher_id = ? OR s.tg_id = ?) AND l.status IN ('scheduled', 'pending') AND l.starts_at >= ? ORDER BY l.starts_at LIMIT 500`)
    .bind(user.tg_id, user.tg_id, since).all();
  const stamp = icsUtc(Date.now());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SlotMate//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Уроки (SlotMate)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const l of results) {
    const start = localToUtcMs(l.starts_at), end = start + l.duration_min * 60000;
    const asTeacher = l.teacher_id === user.tg_id;
    const desc = l.status === 'pending' && l.proposed_start ? `Предложен перенос на ${fmt(l.proposed_start)}, ждём ответа.` : 'Из SlotMate.';
    lines.push('BEGIN:VEVENT', `UID:lesson-${l.id}-${asTeacher ? 't' : 's'}@slotmate`, `DTSTAMP:${stamp}`, `DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`,
      `SUMMARY:${icsText(`Урок · ${asTeacher ? l.student_name : l.teacher_name}`)}`, `DESCRIPTION:${icsText(desc)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(foldLine).join('\r\n') + '\r\n', { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' } });
}
function icsUtc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length, limit = out.length ? 74 : 75;
    if (curBytes + b > limit) { out.push(cur); cur = ''; curBytes = 0; }
    cur += ch; curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// ---------- напоминания (раз в час по расписанию) ----------

async function runHourly(env, origin) {
  const now = nowLocal(), until = nowLocal(24 * 3600 * 1000), today = now.slice(0, 10), hour = Number(now.slice(11, 13));
  // Каждый шаг — отдельно: если один упадёт (например, нет связи), остальные всё равно выполнятся.
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error('hourly step failed', name, (e && e.stack) || e); } };

  await step('reminders', async () => {
  // 1. Ученикам — за сутки до урока, с кнопками «Буду / Не смогу».
  const { results: soon } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.reminded = 0 AND l.status IN ('scheduled', 'pending') AND l.starts_at > ? AND l.starts_at <= ?`).bind(now, until).all();
  for (const l of soon) {
    const b = await balanceOf(env, l.student_id);
    const sub = b.paid > 0 ? `\nАбонемент: ${b.left > 0 ? `осталось ${lessonsWord(b.left)}` : 'оплаченные уроки закончились'}.` : '';
    const pend = l.status === 'pending' && l.proposed_start ? `\nПредложен перенос на ${fmt(l.proposed_start)} — ответа пока нет, урок пока на этом времени.` : '';
    await send(env, l.student_tg, `Напоминание: урок <b>${fmt(l.starts_at)}</b> (учитель: ${esc(l.teacher_name)}).${pend}${sub}`,
      { inline_keyboard: [[{ text: 'Буду', callback_data: `cf:${l.id}` }, { text: 'Не смогу', callback_data: `cn:${l.id}` }]] });
    await env.DB.prepare('UPDATE lessons SET reminded = 1 WHERE id = ?').bind(l.id).run();
  }
  });

  await step('summary', async () => {
  // 2. Учителям — вечером список уроков на завтра.
  if (hour >= 19) {
    const tomorrow = addDays(today, 1);
    const { results: teachers } = await env.DB.prepare('SELECT * FROM users WHERE is_teacher = 1 AND (last_summary IS NULL OR last_summary != ?)').bind(today).all();
    for (const t of teachers) {
      const { results: ls } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.teacher_id = ? AND substr(l.starts_at, 1, 10) = ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`).bind(t.tg_id, tomorrow).all();
      if (ls.length) {
        const rows = ls.map((l) => `${l.starts_at.slice(11, 16)} — ${esc(l.student_name)}${l.status === 'pending' ? ' (ждёт ответа на перенос)' : ''}${l.reminder_answer === 'no' ? ' (не сможет)' : ''}`);
        await send(env, t.tg_id, `Завтра, ${fmtDate(tomorrow)}: ${lessonsWord(ls.length)}\n${rows.join('\n')}`, origin ? appButton(origin) : undefined);
      }
      await env.DB.prepare('UPDATE users SET last_summary = ? WHERE tg_id = ?').bind(today, t.tg_id).run();
    }
  }
  });

  await step('open-questions', async () => {
  // 3а. Урок уже начался, а вопрос не решён (перенос не подтвердили или ученик писал «не смогу»).
  //     Урок не списывается, пока учитель не ответит «состоялся / не состоялся».
  const { results: open } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.check_needed = 0 AND l.starts_at <= ? AND (l.status = 'pending' OR (l.status = 'scheduled' AND l.reminder_answer = 'no'))`).bind(now).all();
  for (const l of open) {
    let why;
    if (l.status === 'pending') {
      why = `Перенос на ${fmt(l.proposed_start)} так и не подтвердили.`;
      await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} уже начался — предложение перенести на ${fmt(l.proposed_start)} больше не действует.`);
      const proposer = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
      if (proposer !== l.teacher_id) await send(env, proposer, `На ваше предложение перенести урок ${fmt(l.starts_at)} не ответили до начала урока — оно больше не действует. Учитель решит, как быть с этим уроком.`);
    } else why = 'Ученик ответил на напоминание «не смогу».';
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', check_needed = 1, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
    await send(env, l.teacher_id, `Урок ${esc(l.student_name)} <b>${fmt(l.starts_at)}</b> прошёл, но вопрос остался открытым. ${why}\nУрок состоялся?`, { inline_keyboard: [
      [{ text: 'Да, списать', callback_data: `hd:${l.id}` }, { text: 'Нет, не списывать', callback_data: `nh:${l.id}` }],
    ] });
  }
  });

  await step('expired-proposals', async () => {
  // 3б. Предложенное время наступило раньше урока, а ответа нет — закрыть предложение, сообщить обоим.
  const { results: expired } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.status = 'pending' AND l.proposed_start <= ?`).bind(now).all();
  for (const l of expired) {
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
    await closeProposalMsg(env, l, `Предложенное время ${fmt(l.proposed_start)} прошло без ответа. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`);
    const proposer = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
    await send(env, proposer, `На ваше предложение перенести урок на ${fmt(l.proposed_start)} не ответили, и это время прошло. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`, origin ? appButton(origin, 'Предложить другое время', `l=${l.id}`) : undefined);
  }
  });

  await step('auto-extend', async () => {
  // 4а. Серии «без срока»: когда запланировано меньше чем на 4 недели вперёд — продлить на 12 недель.
  const { results: autos } = await env.DB.prepare(`SELECT sa.series_id FROM series_auto sa JOIN lessons l ON l.series_id = sa.series_id AND l.status IN ${ACTIVE} GROUP BY sa.series_id HAVING MAX(l.starts_at) <= ?`)
    .bind(nowLocal(28 * 24 * 3600 * 1000)).all();
  for (const a of autos) await extendSeries(env, null, a.series_id, { system: true });
  });

  await step('extend-prompt', async () => {
  // 4б. Обычная серия заканчивается через 2 недели — спросить учителя.
  const { results: ends } = await env.DB.prepare(`SELECT series_id, MAX(starts_at) AS last FROM lessons WHERE series_id IS NOT NULL AND status IN ${ACTIVE} AND series_id NOT IN (SELECT series_id FROM series_auto) GROUP BY series_id HAVING MAX(starts_at) > ? AND MAX(starts_at) <= ?`)
    .bind(now, nowLocal(14 * 24 * 3600 * 1000)).all();
  for (const e of ends) {
    const key = `ext:${e.series_id}`;
    if (await env.DB.prepare('SELECT 1 FROM meta WHERE k = ?').bind(key).first()) continue;
    const { results: ls } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.starts_at = ?`).bind(e.series_id, e.last).all();
    const l = ls[0];
    if (!l) continue;
    await send(env, l.teacher_id, `Заканчиваются регулярные уроки: ${esc(l.student_name)}, последний — ${fmt(l.starts_at)}. Продолжать каждую неделю?`,
      { inline_keyboard: [[{ text: 'Продлевать автоматически', callback_data: `ex:${e.series_id}` }], [{ text: 'Не продлевать', callback_data: `nx:${e.series_id}` }]] });
    await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(key, today).run();
  }
  });

  await step('pay-reminders', async () => {
  // 5. За 3 часа до урока: если оплаченные уроки закончились — учителю кнопки «за сколько уроков получил оплату» (одно нажатие).
  const { results: due } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.pay_asked = 0 AND l.teacher_id > 0 AND l.status IN ${ACTIVE} AND COALESCE(l.reminder_answer, '') != 'no' AND l.starts_at > ? AND l.starts_at <= ? ORDER BY l.starts_at`)
    .bind(now, nowLocal(3 * 3600 * 1000)).all();
  for (const l of due) {
    await env.DB.prepare('UPDATE lessons SET pay_asked = 1 WHERE id = ?').bind(l.id).run();
    const set = await settingsOf(env, l.teacher_id);
    const used = set.pack_price || await env.DB.prepare('SELECT 1 FROM payments WHERE teacher_id = ? LIMIT 1').bind(l.teacher_id).first();
    if (!used) continue; // учитель не ведёт оплаты в приложении — не беспокоим
    if (await env.DB.prepare("SELECT 1 FROM pay_claims WHERE student_id = ? AND status = 'open'").bind(l.student_id).first()) continue;
    if (await lessonCovered(env, l)) continue;
    const b = await balanceOf(env, l.student_id);
    const debt = b.left < 0 ? ` Долг: ${lessonsWord(-b.left)}.` : '';
    const none = !b.paid && !b.used;
    // Кнопки: за сколько уроков получили оплату (1 / абонемент / два), «Другое…» — окно оплаты в приложении.
    const opts = payPresets(set).map((n) => ({ text: payText(set, n), callback_data: `pd:${l.id}:${n}` }));
    opts.push({ text: 'Другое…', web_app: { url: appUrl(origin, `s=${l.student_id}&pay=1`) } });
    await send(env, l.teacher_id, `Сегодня в <b>${l.starts_at.slice(11, 16)}</b> — ${esc(l.student_name)}. ${none ? 'Оплаты ещё не было.' : 'Оплаченные уроки закончились.'}${debt}\nПолучили оплату? Нажмите, за сколько уроков:`, { inline_keyboard: [
      opts.slice(0, 2), opts.slice(2),
      [{ text: 'Пока не оплатил', callback_data: `pl:${l.id}` }],
    ] });
  }
  });

  await step('stale-proposals', async () => {
  // 6. Предложение без ответа больше суток — напомнить тому, кто должен ответить.
  const dayAgo = nowLocal(-24 * 3600 * 1000);
  const { results: stale } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.status = 'pending' AND l.pinged = 0 AND l.proposed_at IS NOT NULL AND l.proposed_at <= ? AND l.proposed_start > ?`).bind(dayAgo, now).all();
  for (const l of stale) {
    await closeProposalMsg(env, l, 'Это предложение продублировано ниже.');
    await env.DB.prepare('UPDATE lessons SET pinged = 1, proposal_chat = NULL, proposal_msg = NULL WHERE id = ?').bind(l.id).run();
    if (origin) await sendProposal(env, l, origin, 'Ждём вашего ответа уже сутки.\n\n');
  }
  });
}
