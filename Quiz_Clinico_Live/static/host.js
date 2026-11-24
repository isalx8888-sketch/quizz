const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pass = sessionStorage.getItem('quiz_host_pass') || '';
let status = null, info = null, bankDraft = null, toastId = null;

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hide');
  clearTimeout(toastId); toastId = setTimeout(() => el.classList.add('hide'), 4000);
}
async function api(path, opts={}) {
  const r = await fetch(path, { ...opts, headers: {'Authorization': `Bearer ${pass}`, ...(opts.body ? {'Content-Type':'application/json'} : {}), ...opts.headers} });
  if (!r.ok) {
    let msg='No se ha podido completar la operación.';
    try {const body=await r.json();msg=body.detail || msg;} catch {}
    throw Error(msg);
  }
  return r.json();
}
function rankingHTML(ranking, limit=10) {
  if (!ranking?.length) return '<p class="muted">Aún no hay puntuaciones.</p>';
  return `<ol class="rank-list">${ranking.slice(0,limit).map(x=>`<li class="rank-row"><span class="rank-num">${x.position}</span><span><strong>${esc(x.name)}</strong><span class="rank-sub">${x.correct} ${x.correct === 1 ? 'acierto' : 'aciertos'}</span></span><strong class="rank-points">${x.score.toLocaleString('es-ES')} pt</strong></li>`).join('')}</ol>`;
}
function lobbyHTML(s) {
  const url=info?.join_url || `${location.origin}/play`;
  const people=s.players || [];
  return `<div class="grid2"><section class="panel"><div class="eyebrow">SALA DE ESPERA</div><h2>Todo listo para empezar.</h2><p class="muted">Comparte el QR o el enlace. Cada participante introduce su nombre desde el móvil y aparecerá aquí.</p><div class="number-box"><div class="metric"><strong>${s.players_count}</strong><span>Participantes</span></div><div class="metric"><strong>${s.count}</strong><span>Preguntas</span></div></div><h3 style="margin-top:27px;margin-bottom:6px">Participantes conectados</h3><div class="chips">${people.length ? people.map(x=>`<span class="chip">${esc(x.name)}</span>`).join('') : '<span class="muted">Todavía no se ha unido nadie.</span>'}</div><div class="big-cta"><div><strong>¿Listos para jugar?</strong><p class="muted">Tú decides cuándo comienza cada pregunta.</p></div><button data-action="next" class="btn primary large" ${!s.count?'disabled title="Primero añade preguntas"':''}>Empezar quiz →</button></div>${!s.count?'<p class="notice">Añade preguntas desde «Editar preguntas» antes de empezar.</p>':''}</section><aside class="panel soft"><div class="eyebrow">INVITACIÓN A LA SALA</div><h2>Escanea y participa</h2><img class="qrcode" src="/api/qr" alt="Código QR para unirse al quiz"><p class="qr-caption">Código de sala <strong>${esc(s.room)}</strong></p><div class="share-url">${esc(url)}</div><button class="btn outline btn-block" data-copy>⧉ Copiar enlace de participación</button><p class="tiny" style="margin-top:15px">Los móviles deben poder acceder a esta dirección. En una red local, todos deben estar en la misma Wi-Fi y la red debe permitir comunicación entre dispositivos.</p></aside></div>`;
}
function questionHTML(s) {
  const q=s.question, reveal=s.phase==='reveal';
  const answer=s.answers_distribution || [];
  const max=Math.max(1,...answer);
  const complete=s.index+1>=s.count;
  const totalDone=s.answered_count;
  return `<div class="grid2"><section class="panel"><div class="question-top"><span class="question-tag">PREGUNTA ${q.number} DE ${q.total}</span>${reveal ? '<span class="good-msg">✓ Respuesta revelada</span>':`<div class="timer" id="hostTimer">⏱ ${Math.ceil(s.remaining)} s</div>`}</div>${!reveal?`<div class="progress-track"><div id="hostProgress" class="progress-fill" style="width:${Math.max(0,100*s.remaining/q.seconds)}%"></div></div>`:''}<h2 class="question-text">${esc(q.text)}</h2><div>${q.options.map((o,i)=>`<div class="option ${reveal && i===q.correct?'correct':''}"><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span>${reveal && i===q.correct?'<span style="margin-left:auto">✓</span>':''}</div>`).join('')}</div>${reveal && q.explanation?`<div class="explanation"><strong>Explicación clínica</strong>${esc(q.explanation)}</div>`:''}<div class="game-actions">${reveal ? (complete?'<button class="btn primary large" data-action="finish">Ver ranking final →</button>':'<button class="btn primary large" data-action="next">Siguiente pregunta →</button>') : '<button class="btn danger" data-action="reveal">Revelar respuesta ahora</button>'}<span class="tiny">${reveal?'Puedes comentar la respuesta antes de continuar.':'La pregunta se cierra automáticamente al terminar el tiempo.'}</span></div></section><aside><section class="panel"><div class="eyebrow">RESPUESTAS EN TIEMPO REAL</div><div class="number-box"><div class="metric"><strong>${totalDone}</strong><span>Respondidas</span></div><div class="metric"><strong>${s.players_count}</strong><span>Inscritos</span></div></div>${reveal?`<h3 style="margin-top:25px">Distribución de respuestas</h3>${q.options.map((o,i)=>`<div class="bar-line"><span class="bar-label">${String.fromCharCode(65+i)} · ${esc(o)}</span><span class="bar-track"><span class="bar-fill ${i===q.correct?'good':''}" style="display:block;width:${Math.round(100*(answer[i]||0)/max)}%"></span></span><span class="bar-count">${answer[i]||0}</span></div>`).join('')}`:`<h3 style="margin-top:23px">¿Quién ha respondido?</h3><div class="chips participant-list">${s.players?.length?s.players.map(p=>`<span class="chip ${p.answered?'yes':''}">${esc(p.name)}</span>`).join(''):'<p class="muted">Esperando participantes...</p>'}</div>`}</section>${reveal?`<section class="panel" style="margin-top:20px"><div class="eyebrow">CLASIFICACIÓN GENERAL</div><h3 style="margin:10px 0">Ranking provisional</h3>${rankingHTML(s.ranking)}</section>`:''}</aside></div>`;
}
function finishedHTML(s) {
  const r=s.ranking||[];
  return `<div class="grid2"><section class="panel"><div class="eyebrow">QUIZ FINALIZADO</div><h1>¡Sesión completada! <em>🏆</em></h1><p class="muted">Clasificación final por aciertos y tiempo de respuesta.</p>${r.length?`<div class="big-cta"><div><div class="eyebrow">GANADOR / GANADORA</div><h2 style="font-size:32px;margin:8px 0">🥇 ${esc(r[0].name)}</h2><p class="muted">${r[0].score.toLocaleString('es-ES')} puntos · ${r[0].correct} aciertos</p></div></div>`:'<p class="muted">Sin participantes.</p>'}<div class="game-actions"><button class="btn primary" data-export>↓ Descargar ranking CSV</button><button class="btn outline" data-action="reset">↻ Jugar otra vez</button></div></section><section class="panel"><div class="eyebrow">RANKING FINAL</div>${rankingHTML(r,300)}</section></div>`;
}
function render(s) {
  status=s;
  $('sessionTitle').textContent=s.title;
  $('roomCode').textContent=s.room;
  $('peopleCount').textContent=s.players_count;
  $('editBtn').disabled=s.phase!=='lobby';
  $('hostContent').innerHTML=s.phase==='lobby'?lobbyHTML(s):s.phase==='finished'?finishedHTML(s):questionHTML(s);
}
async function refresh(){
  if (!pass) return;
  try{const s=await api('/api/host/state'); render(s);}
  catch(err){ if(err.message.includes('clave')||err.message.includes('Clave')){pass='';sessionStorage.removeItem('quiz_host_pass');$('authScreen').classList.remove('hide');$('dashboard').classList.add('hide');toast('Vuelve a introducir tu clave.');}else {toast('Sin conexión con el servidor.');}}
}
async function login(password) {
  pass=password;
  const s=await api('/api/host/state');
  sessionStorage.setItem('quiz_host_pass',pass);
  $('authScreen').classList.add('hide');$('dashboard').classList.remove('hide');
  info=await fetch('/api/info').then(r=>r.json());
  render(s);
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('authError').textContent='';
  try {await login($('hostPassword').value.trim());}
  catch(err){pass='';$('authError').textContent=err.message;}
});
$('hostContent').addEventListener('click',async e=>{
  const act=e.target.closest('[data-action]'),copy=e.target.closest('[data-copy]'),ex=e.target.closest('[data-export]');
  if(copy){try {await navigator.clipboard.writeText(info?.join_url||`${location.origin}/play`);toast('Enlace copiado.');}catch {toast('Copia el enlace que aparece sobre el botón.');}}
  if(ex) return exportRanking();
  if(!act)return;
  const action=act.dataset.action;
  if(action==='reset'&&!confirm('¿Borrar participantes y puntuaciones para iniciar una nueva partida?'))return;
  act.disabled=true;
  try {await api('/api/host/action',{method:'POST',body:JSON.stringify({action})});await refresh();}
  catch(err){toast(err.message);act.disabled=false;}
});
$('resetBtn').addEventListener('click',async()=>{
  if(!confirm('¿Borrar participantes y puntuaciones? Esta acción no se puede deshacer.'))return;
  try {await api('/api/host/action',{method:'POST',body:JSON.stringify({action:'reset'})});toast('Partida reiniciada.');await refresh();}catch(err){toast(err.message);}
});
async function exportRanking(){
  try{
    const r=await fetch('/api/host/export',{headers:{Authorization:`Bearer ${pass}`}});
    if(!r.ok)throw Error('No se ha podido exportar el ranking.');
    const u=URL.createObjectURL(await r.blob()), a=document.createElement('a');
    a.href=u;a.download='ranking_quiz_clinico.csv';a.click();URL.revokeObjectURL(u);
  }catch(err){toast(err.message);}
}
$('exportBtn').addEventListener('click',exportRanking);
$('editBtn').addEventListener('click',()=>{
  if(status?.phase!=='lobby')return;
  bankDraft=structuredClone(status.bank);
  $('editorModal').classList.remove('hide');renderEditor();
});
function closeEditor(){$('editorModal').classList.add('hide');bankDraft=null;}
$('closeEditor').addEventListener('click',closeEditor);
$('cancelEditor').addEventListener('click',closeEditor);
$('editorModal').addEventListener('click',e=>{if(e.target===$('editorModal'))closeEditor();});
function newQuestion(){return {text:'',options:['','','',''],correct:0,seconds:20,explanation:''};}
function renderEditor(){
  if(!bankDraft)return;
  $('bankTitle').value=bankDraft.title;
  $('editorStatus').textContent=`${bankDraft.questions.length} preguntas`;
  $('editorItems').innerHTML=bankDraft.questions.map((q,i)=>`<article class="editor-card" data-q="${i}"><div class="editor-top"><strong>Pregunta ${i+1}</strong><div class="inline-actions"><button class="btn outline" data-move="up" title="Subir" ${i===0?'disabled':''}>↑</button><button class="btn outline" data-move="down" title="Bajar" ${i===bankDraft.questions.length-1?'disabled':''}>↓</button><button class="btn danger" data-delete>Eliminar</button></div></div><label class="field-label">Enunciado</label><textarea data-field="text" maxlength="300" rows="2" placeholder="Escribe la pregunta">${esc(q.text)}</textarea><label class="field-label">Opciones (marca la correcta)</label><div class="editor-options">${q.options.map((opt,j)=>`<div class="editor-option"><input type="radio" name="correct_${i}" value="${j}" data-correct ${j===q.correct?'checked':''} title="Respuesta correcta"><input type="text" data-option="${j}" maxlength="180" value="${esc(opt)}" placeholder="Opción ${String.fromCharCode(65+j)}"><button class="xbtn" data-remove="${j}" title="Eliminar opción" ${q.options.length<=2?'disabled':''}>×</button></div>`).join('')}</div>${q.options.length<4?'<button class="btn small outline" style="margin-top:9px" data-add-option>＋ Opción</button>':''}<div class="two-fields"><div><label class="field-label">Tiempo (segundos)</label><input type="number" data-field="seconds" min="5" max="120" value="${q.seconds}"></div><div style="flex:1"><label class="field-label">Explicación al revelar (opcional)</label><textarea data-field="explanation" maxlength="1200" rows="2" placeholder="Por qué es correcta esta opción">${esc(q.explanation)}</textarea></div></div></article>`).join('')||'<p class="notice">No hay preguntas. Pulsa «Añadir pregunta».</p>';
}
$('bankTitle').addEventListener('input',e=>{if(bankDraft)bankDraft.title=e.target.value;});
$('editorItems').addEventListener('input',e=>{
  if(!bankDraft)return;
  const card=e.target.closest('[data-q]');if(!card)return;
  const q=bankDraft.questions[Number(card.dataset.q)];
  if(e.target.hasAttribute('data-option'))q.options[Number(e.target.dataset.option)]=e.target.value;
  if(e.target.hasAttribute('data-field')){const field=e.target.dataset.field;q[field]=field==='seconds'?Number(e.target.value):e.target.value;}
  if(e.target.hasAttribute('data-correct'))q.correct=Number(e.target.value);
});
$('editorItems').addEventListener('change',e=>{
  if(e.target.hasAttribute('data-correct')){
    const card=e.target.closest('[data-q]');bankDraft.questions[Number(card.dataset.q)].correct=Number(e.target.value);
  }
});
$('editorItems').addEventListener('click',e=>{
  if(!bankDraft)return;
  const card=e.target.closest('[data-q]');if(!card)return;
  const i=Number(card.dataset.q),q=bankDraft.questions[i];
  if(e.target.closest('[data-delete]')){if(!confirm('¿Eliminar esta pregunta?'))return;bankDraft.questions.splice(i,1);renderEditor();}
  else if(e.target.closest('[data-add-option]')){if(q.options.length<4)q.options.push('');renderEditor();}
  else if(e.target.closest('[data-remove]')){
    const j=Number(e.target.dataset.remove);if(q.options.length<=2)return;
    q.options.splice(j,1);if(q.correct===j)q.correct=0;else if(q.correct>j)q.correct--;renderEditor();
  } else if(e.target.closest('[data-move]')){
    const j=i+(e.target.closest('[data-move]').dataset.move==='up'?-1:1);
    [bankDraft.questions[i],bankDraft.questions[j]]=[bankDraft.questions[j],bankDraft.questions[i]];renderEditor();
  }
});
$('addQuestion').addEventListener('click',()=>{
  if(bankDraft.questions.length>=100)return toast('Máximo 100 preguntas.');
  bankDraft.questions.push(newQuestion());renderEditor();$('editorItems').lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'});
});
$('saveEditor').addEventListener('click',async()=>{
  try{
    await api('/api/host/bank',{method:'POST',body:JSON.stringify(bankDraft)});
    closeEditor();toast('Preguntas guardadas.');await refresh();
  }catch(err){toast(err.message);}
});
$('importFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try {const imported=JSON.parse(await file.text());
    if(Array.isArray(imported))bankDraft={title:bankDraft.title,questions:imported};
    else if(imported && Array.isArray(imported.questions))bankDraft=imported;
    else throw Error('El archivo debe contener {"title":"...","questions":[...]} o un array de preguntas.');
    renderEditor();toast('Banco importado. Revisa y guarda los cambios.');
  }catch(err){toast('Importación fallida: '+err.message);}e.target.value='';
});
$('downloadBank').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(bankDraft,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='preguntas_quiz.json';a.click();URL.revokeObjectURL(url);
});
function drawTimer(){
  if(!status||status.phase!=='question')return;
  const sec=Math.max(0,status.remaining-(performance.now()-(window.lastUpdate||performance.now()))/1000);
  const el=$('hostTimer');if(el){el.textContent=`⏱ ${Math.ceil(sec)} s`;el.classList.toggle('urgent',sec<=5);}
  const pr=$('hostProgress');if(pr)pr.style.width=`${100*sec/status.question.seconds}%`;
}
async function init(){
  $('clock').textContent='● EN DIRECTO';
  if(pass){try{await login(pass);}catch{pass='';sessionStorage.removeItem('quiz_host_pass');}}
  setInterval(async()=>{if(pass && $('dashboard').classList.contains('hide')===false){await refresh();window.lastUpdate=performance.now();}},900);
  setInterval(drawTimer,100);
}
init();
