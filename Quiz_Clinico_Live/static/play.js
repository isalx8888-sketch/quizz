const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters=['A','B','C','D'];
let token=localStorage.getItem('clinicalQuizToken')||'',snapshot=null,paintKey='',lastPollAt=0,sending=false;
const toastEl=$('toast');let toastTimer;
function toast(s){toastEl.textContent=s;toastEl.classList.remove('hide');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.add('hide'),3200);}
async function post(path,payload){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok){let msg='No se ha podido conectar.';try{msg=(await r.json()).detail||msg;}catch{}throw Error(msg);}
  return r.json();
}
function rankingHTML(ranking,name){
  if(!ranking?.length)return '<p class="muted">Aún no hay puntuaciones.</p>';
  return `<ol class="rank-list">${ranking.slice(0,20).map(x=>`<li class="rank-row ${x.name===name?'highlight-me':''}"><span class="rank-num">${x.position}</span><span><strong>${esc(x.name)}</strong><span class="rank-sub">${x.correct} ${x.correct===1?'acierto':'aciertos'}</span></span><strong class="rank-points">${x.score.toLocaleString('es-ES')} pt</strong></li>`).join('')}</ol>`;
}
function waitingHTML(s){
  return `<div class="player-card"><div class="player-header"><span class="eyebrow">CONECTADO A LA SESIÓN</span><span class="player-name">👤 ${esc(s.me.name)}</span></div><div class="player-feedback"><span class="wait-icon">✨</span><h2>¡Ya estás dentro!</h2><p class="muted">${esc(s.title)}</p><p>El presentador abrirá la primera pregunta.</p><div class="number-box"><div class="metric"><strong>${s.players_count}</strong><span>En la sala</span></div><div class="metric"><strong>${s.count}</strong><span>Preguntas</span></div></div></div><p class="footer-wait">Mantén esta página abierta.</p></div>`;
}
function questionHTML(s){
  const q=s.question;
  if(s.me.answered)return `<div class="player-card"><div class="player-header"><span class="question-tag">PREGUNTA ${q.number}/${q.total}</span><span class="player-name">👤 ${esc(s.me.name)}</span></div><div class="player-feedback"><div class="checkmark">✓</div><h2>¡Respuesta registrada!</h2><p class="muted">Has elegido la opción <strong>${letters[s.me.choice]}</strong>. Espera a que se revele la respuesta.</p><div class="timer" id="playerTimer" style="justify-content:center;margin-top:22px">⏱ ${Math.ceil(s.remaining)} s</div></div></div>`;
  return `<div class="player-card"><div class="player-header"><span class="question-tag">PREGUNTA ${q.number} / ${q.total}</span><span class="player-name">👤 ${esc(s.me.name)}</span></div><div class="question-top"><span class="eyebrow">ELIGE UNA RESPUESTA</span><div class="timer" id="playerTimer">⏱ ${Math.ceil(s.remaining)} s</div></div><div class="progress-track"><div id="playerProgress" class="progress-fill" style="width:${100*s.remaining/q.seconds}%"></div></div><h2>${esc(q.text)}</h2><div>${q.options.map((opt,i)=>`<button class="option selectable" data-answer="${i}"><span class="letter">${letters[i]}</span><span>${esc(opt)}</span></button>`).join('')}</div><p class="footer-wait">Responde antes de que acabe el tiempo. Solo tienes un intento.</p></div>`;
}
function revealHTML(s){
  const q=s.question,me=s.me,pts=me.earned||0;
  const wasRight=me.answered && me.choice===q.correct;
  const msg=wasRight?'¡Correcto!':me.answered?'Esta vez no ha sido...':'Se ha acabado el tiempo';
  const selected=me.answered ? me.choice : -1;
  return `<div class="player-card"><div class="player-header"><span class="question-tag">RESULTADO · ${q.number}/${q.total}</span><span class="player-name">👤 ${esc(me.name)}</span></div><div class="player-feedback"><div class="checkmark" style="background:${wasRight?'#e8f7f1':'#fff0f1'};color:${wasRight?'#087760':'#b3505d'}">${wasRight?'✓':'!'}</div><h2>${msg}</h2><p class="result-points ${wasRight?'':'miss'}">+${pts.toLocaleString('es-ES')}<span style="font-size:16px"> pt</span></p><div class="personal-summary"><div><strong>#${me.position||'—'}</strong>Tu posición</div><div><strong>${(s.ranking?.find(x=>x.name===me.name)?.score||0).toLocaleString('es-ES')}</strong>Puntos totales</div></div></div><div class="eyebrow" style="margin-bottom:10px">RESPUESTA CORRECTA</div>${q.options.map((opt,i)=>`<div class="option ${i===q.correct?'correct':i===selected?'wrong':'muted-option'}"><span class="letter">${letters[i]}</span>${esc(opt)}${i===q.correct?'<span style="margin-left:auto">✓</span>':''}</div>`).join('')}${q.explanation?`<div class="explanation"><strong>Por qué</strong>${esc(q.explanation)}</div>`:''}<div class="leader-title">Ranking general</div>${rankingHTML(s.ranking,me.name)}<p class="footer-wait">El presentador decidirá cuándo avanzar.</p></div>`;
}
function finalHTML(s){
  const rank=s.ranking||[],me=rank.find(x=>x.name===s.me.name);
  return `<div class="player-card"><div class="player-header"><span class="eyebrow">SESIÓN COMPLETADA</span><span class="player-name">👤 ${esc(s.me.name)}</span></div><div class="player-feedback"><span class="wait-icon">🏆</span><h2>¡Gracias por participar!</h2><p class="muted">Tu resultado final</p><div class="personal-summary"><div><strong>#${me?.position||'—'}</strong>Posición</div><div><strong>${(me?.score||0).toLocaleString('es-ES')}</strong>Puntos</div><div><strong>${me?.correct||0}</strong>Aciertos</div></div></div><div class="leader-title">Clasificación final</div>${rankingHTML(rank,s.me.name)}</div>`;
}
function render(s){
  snapshot=s;
  if(!s.me){
    $('joinScreen').classList.remove('hide');$('playerContent').classList.add('hide');
    $('joinTitle').textContent=`${s.title}. Introduce tu nombre para participar.`;
    if(!($('playerName').value))$('playerName').value=localStorage.getItem('clinicalQuizName')||'';
    paintKey='';return;
  }
  $('joinScreen').classList.add('hide');$('playerContent').classList.remove('hide');
  const key=`${s.phase}:${s.index}:${s.me.answered}:${s.me.choice}:${s.phase==='lobby'||s.phase==='reveal'||s.phase==='finished'?s.revision:0}`;
  if(key===paintKey)return;paintKey=key;
  const el=$('playerContent');
  el.innerHTML=s.phase==='lobby'?waitingHTML(s):s.phase==='question'?questionHTML(s):s.phase==='reveal'?revealHTML(s):finalHTML(s);
  if(sending)el.querySelectorAll('[data-answer]').forEach(b=>b.disabled=true);
}
async function poll(){
  try{const r=await fetch(`/api/state${token?'?token='+encodeURIComponent(token):''}`,{cache:'no-store'});const s=await r.json();lastPollAt=performance.now();render(s);}
  catch{toast('Problema de conexión. Reintentando…');}
}
$('joinForm').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('playerName').value.trim();if(!name)return;
  $('joinError').textContent='';
  try{
    const joined=await post('/api/join',{name,token:token||null});
    token=joined.token;localStorage.setItem('clinicalQuizToken',token);localStorage.setItem('clinicalQuizName',joined.name);
    await poll();
  }catch(err){$('joinError').textContent=err.message;}
});
$('playerContent').addEventListener('click',async e=>{
  const b=e.target.closest('[data-answer]');if(!b||sending||!snapshot||snapshot.phase!=='question')return;
  sending=true;
  const choice=Number(b.dataset.answer);
  $('playerContent').querySelectorAll('[data-answer]').forEach(x=>x.disabled=true);
  b.classList.add('selected');
  try{await post('/api/answer',{choice,question_index:snapshot.index,token});await poll();}
  catch(err){toast(err.message);await poll();}
  finally{sending=false;}
});
function updateTimer(){
  if(!snapshot||snapshot.phase!=='question')return;
  const elapsed=(performance.now()-lastPollAt)/1000;
  const secs=Math.max(0,snapshot.remaining-elapsed);
  const t=$('playerTimer');if(t){t.textContent=`⏱ ${Math.ceil(secs)} s`;t.classList.toggle('urgent',secs<=5);}
  const p=$('playerProgress');if(p)p.style.width=`${100*secs/snapshot.question.seconds}%`;
  if(secs<=0)$('playerContent').querySelectorAll('[data-answer]').forEach(b=>b.disabled=true);
}
(async()=>{await poll();setInterval(poll,900);setInterval(updateTimer,100);})();
