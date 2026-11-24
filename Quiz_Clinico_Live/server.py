"""Quiz Clínico Live — juego multijugador controlado por el ponente.
Ejecutar: python server.py  (o uvicorn server:app --host 0.0.0.0 --port 8000)
"""
from __future__ import annotations

import csv
import io
import json
import os
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import qrcode
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'questions.json'
STATIC = ROOT / 'static'
HOST_PASSWORD = os.getenv('QUIZ_HOST_PASSWORD') or secrets.token_urlsafe(8)
ROOM_CODE = ''.join(str(secrets.randbelow(10)) for _ in range(6))
LOCK = threading.RLock()


def load_bank() -> dict[str, Any]:
    if DATA.exists():
        try:
            blob = json.loads(DATA.read_text(encoding='utf-8'))
            return validate_bank(blob)
        except Exception as err:
            print(f'[Aviso] Banco de preguntas no válido: {err}')
    return {'title': 'Sesión clínica · Colestasis pediátrica', 'questions': []}


def validate_bank(payload: Any) -> dict[str, Any]:
    if isinstance(payload, list):
        payload = {'title': 'Mi sesión clínica', 'questions': payload}
    if not isinstance(payload, dict):
        raise ValueError('El banco debe ser un objeto JSON o una lista de preguntas.')
    title = str(payload.get('title', 'Mi sesión clínica')).strip()
    if not title or len(title) > 120:
        raise ValueError('El título debe tener entre 1 y 120 caracteres.')
    questions = payload.get('questions')
    if not isinstance(questions, list) or len(questions) > 100:
        raise ValueError('Debe incluir una lista de hasta 100 preguntas.')
    clean = []
    for num, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            raise ValueError(f'Pregunta {num}: formato no válido.')
        txt = str(q.get('text', '')).strip()
        opts = q.get('options')
        correct = q.get('correct')
        seconds = q.get('seconds', 20)
        explanation = str(q.get('explanation', '')).strip()
        if not txt or len(txt) > 300:
            raise ValueError(f'Pregunta {num}: enunciado obligatorio (máx. 300 caracteres).')
        if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
            raise ValueError(f'Pregunta {num}: se requieren entre 2 y 4 opciones.')
        opts = [str(x).strip() for x in opts]
        if any(not x or len(x) > 180 for x in opts):
            raise ValueError(f'Pregunta {num}: opciones vacías o excesivamente largas.')
        if type(correct) is not int or not 0 <= correct < len(opts):
            raise ValueError(f'Pregunta {num}: correct debe ser un índice desde 0.')
        if type(seconds) is not int or not 5 <= seconds <= 120:
            raise ValueError(f'Pregunta {num}: seconds debe ser de 5 a 120.')
        if len(explanation) > 1200:
            raise ValueError(f'Pregunta {num}: explicación excesivamente larga.')
        clean.append({'text': txt, 'options': opts, 'correct': correct,
                      'seconds': seconds, 'explanation': explanation})
    return {'title': title, 'questions': clean}


BANK = load_bank()
# Los resultados se mantienen en memoria durante la sesión.
state = {'phase': 'lobby', 'index': -1, 'started_at': 0.0, 'deadline': 0.0,
         'players': {}, 'answers': {}, 'revision': 0}


def tick() -> None:
    if state['phase'] == 'question' and time.monotonic() >= state['deadline']:
        state['phase'] = 'reveal'
        state['revision'] += 1


def rankings(include_current: bool = False) -> list[dict[str, Any]]:
    max_index = state['index'] if include_current else state['index'] - 1
    result = []
    for token, p in state['players'].items():
        score = 0
        correct_count = 0
        ms_total = 0
        for i in range(max_index + 1):
            a = state['answers'].get(i, {}).get(token)
            if a:
                score += a['points']
                if a['points']:
                    correct_count += 1
                    ms_total += a['elapsed_ms']
        result.append({'name': p['name'], 'score': score, 'correct': correct_count,
                       'total_ms': ms_total, 'token': token})
    result.sort(key=lambda x: (-x['score'], x['total_ms'] if x['correct'] else 10**12, x['name'].casefold()))
    for i, p in enumerate(result, 1):
        p['position'] = i
    return result


def public_rankings() -> list[dict[str, Any]]:
    reveal = state['phase'] in ('reveal', 'finished')
    return [{k: p[k] for k in ('position', 'name', 'score', 'correct')} for p in rankings(reveal)]


def current_question(*, reveal: bool = False) -> dict[str, Any] | None:
    i = state['index']
    if i < 0 or i >= len(BANK['questions']):
        return None
    q = BANK['questions'][i]
    ret = {'text': q['text'], 'options': q['options'], 'seconds': q['seconds'],
           'number': i+1, 'total': len(BANK['questions'])}
    if reveal:
        ret['correct'] = q['correct']
        ret['explanation'] = q['explanation']
    return ret


def state_for(token: str | None = None, is_host: bool = False) -> dict[str, Any]:
    tick()
    phase = state['phase']
    this_answers = state['answers'].get(state['index'], {})
    rem = max(0.0, state['deadline'] - time.monotonic()) if phase == 'question' else 0.0
    result = {'phase': phase, 'room': ROOM_CODE, 'title': BANK['title'],
              'count': len(BANK['questions']), 'index': state['index'],
              'players_count': len(state['players']), 'answered_count': len(this_answers),
              'remaining': round(rem, 2), 'revision': state['revision'],
              'question': current_question(reveal=phase in ('reveal', 'finished') or is_host)}
    if phase in ('reveal', 'finished'):
        result['ranking'] = public_rankings()
        if phase == 'reveal':
            result['answers_distribution'] = [sum(1 for a in this_answers.values() if a['choice']==i)
                                               for i in range(len(BANK['questions'][state['index']]['options']))]
    if is_host:
        result['players'] = [{'name': p['name'], 'answered': t in this_answers}
                             for t, p in state['players'].items()]
        result['bank'] = BANK
    if token:
        p = state['players'].get(token)
        if p:
            a = this_answers.get(token)
            result['me'] = {'name': p['name'], 'answered': bool(a),
                            'choice': a['choice'] if a else None}
            if phase in ('reveal', 'finished'):
                result['me']['earned'] = a['points'] if a else 0
                result['me']['position'] = next((x['position'] for x in rankings(True) if x['token'] == token), None)
    return result


def verify_host(authorization: str | None) -> None:
    key = (authorization or '').removeprefix('Bearer ').strip()
    if not secrets.compare_digest(key, HOST_PASSWORD):
        raise HTTPException(status_code=401, detail='Clave del presentador incorrecta.')


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def join_url(req: Request) -> str:
    public = os.getenv('QUIZ_PUBLIC_URL', '').rstrip('/')
    if public:
        return f'{public}/play'
    origin = str(req.base_url).rstrip('/')
    forwarded_proto = req.headers.get('x-forwarded-proto', '').split(',')[0].strip().lower()
    if forwarded_proto in ('http', 'https'):
        origin = f'{forwarded_proto}://{req.url.netloc}'
    if any(x in origin for x in ('localhost', '127.0.0.1', '0.0.0.0')):
        origin = f'http://{local_ip()}:{req.url.port or 8000}'
    return f'{origin}/play'


class JoinBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    token: str | None = None


class AnswerBody(BaseModel):
    token: str
    choice: int
    question_index: int


class ActionBody(BaseModel):
    action: str


app = FastAPI(title='Quiz Clínico Live', docs_url=None, redoc_url=None)
app.mount('/static', StaticFiles(directory=STATIC), name='static')


@app.get('/')
def homepage():
    return FileResponse(STATIC / 'index.html')


@app.get('/host')
def host_page():
    return FileResponse(STATIC / 'host.html')


@app.get('/play')
def player_page():
    return FileResponse(STATIC / 'play.html')


@app.get('/api/info')
def info(req: Request):
    return {'join_url': join_url(req), 'room': ROOM_CODE, 'title': BANK['title']}


@app.get('/api/qr')
def qr(req: Request):
    image = qrcode.make(join_url(req))
    buf = io.BytesIO()
    image.save(buf, format='PNG')
    return Response(buf.getvalue(), media_type='image/png', headers={'Cache-Control': 'no-cache'})


@app.get('/api/state')
def get_state(token: str | None = None):
    with LOCK:
        return state_for(token=token)


@app.post('/api/join')
def join(body: JoinBody):
    name = ' '.join(body.name.split())
    if not 1 <= len(name) <= 30:
        raise HTTPException(400, 'Introduce un nombre de entre 1 y 30 caracteres.')
    with LOCK:
        tick()
        if body.token and body.token in state['players']:
            return {'token': body.token, 'name': state['players'][body.token]['name']}
        if state['phase'] == 'finished':
            raise HTTPException(409, 'El juego ya ha terminado. Espera a la siguiente sesión.')
        if any(p['name'].casefold() == name.casefold() for p in state['players'].values()):
            raise HTTPException(409, 'Este nombre ya está registrado. Elige otro nombre.')
        if len(state['players']) >= 300:
            raise HTTPException(429, 'Se ha alcanzado el límite de 300 participantes.')
        token = secrets.token_urlsafe(24)
        state['players'][token] = {'name': name, 'joined_at': time.time()}
        state['revision'] += 1
        return {'token': token, 'name': name}


@app.post('/api/answer')
def answer(body: AnswerBody):
    with LOCK:
        tick()
        if body.token not in state['players']:
            raise HTTPException(401, 'Participante no registrado.')
        if state['phase'] != 'question' or body.question_index != state['index']:
            raise HTTPException(409, 'Esta pregunta ya no admite respuestas.')
        q = BANK['questions'][state['index']]
        if not 0 <= body.choice < len(q['options']):
            raise HTTPException(400, 'Opción no válida.')
        answers = state['answers'].setdefault(state['index'], {})
        if body.token in answers:
            raise HTTPException(409, 'Ya has respondido esta pregunta.')
        elapsed_ms = max(0, int((time.monotonic() - state['started_at'])*1000))
        ratio = min(1, elapsed_ms / (q['seconds']*1000))
        pts = (1000 + round(500 * (1 - ratio))) if body.choice == q['correct'] else 0
        answers[body.token] = {'choice': body.choice, 'elapsed_ms': elapsed_ms, 'points': pts}
        state['revision'] += 1
        return {'ok': True}


@app.get('/api/host/state')
def host_state(authorization: str | None = Header(default=None)):
    verify_host(authorization)
    with LOCK:
        return state_for(is_host=True)


@app.post('/api/host/bank')
def host_bank(payload: dict[str, Any], authorization: str | None = Header(default=None)):
    verify_host(authorization)
    try:
        bank = validate_bank(payload)
    except ValueError as err:
        raise HTTPException(400, str(err))
    global BANK
    with LOCK:
        if state['phase'] != 'lobby':
            raise HTTPException(409, 'Para modificar preguntas, reinicia primero el juego.')
        BANK = bank
        DATA.write_text(json.dumps(BANK, ensure_ascii=False, indent=2), encoding='utf-8')
        state['revision'] += 1
        return {'ok': True, 'count': len(BANK['questions'])}


@app.post('/api/host/action')
def host_action(body: ActionBody, authorization: str | None = Header(default=None)):
    verify_host(authorization)
    with LOCK:
        tick()
        action = body.action
        if action == 'next':
            if state['phase'] not in ('lobby', 'reveal'):
                raise HTTPException(409, 'Primero termina la pregunta actual.')
            if state['index']+1 >= len(BANK['questions']):
                raise HTTPException(409, 'Ya no quedan preguntas.')
            state['index'] += 1
            state['phase'] = 'question'
            state['started_at'] = time.monotonic()
            state['deadline'] = state['started_at'] + BANK['questions'][state['index']]['seconds']
            state['answers'][state['index']] = {}
        elif action == 'reveal':
            if state['phase'] != 'question':
                raise HTTPException(409, 'No hay ninguna pregunta abierta.')
            state['phase'] = 'reveal'
        elif action == 'finish':
            if state['phase'] != 'reveal':
                raise HTTPException(409, 'Revela la respuesta antes de finalizar.')
            state['phase'] = 'finished'
        elif action == 'reset':
            state['phase'] = 'lobby'
            state['index'] = -1
            state['started_at'] = 0.0
            state['deadline'] = 0.0
            state['answers'] = {}
            state['players'] = {}
            global ROOM_CODE
            ROOM_CODE = ''.join(str(secrets.randbelow(10)) for _ in range(6))
        else:
            raise HTTPException(400, 'Acción desconocida.')
        state['revision'] += 1
        return {'ok': True, 'phase': state['phase']}


@app.get('/api/host/export')
def export_csv(authorization: str | None = Header(default=None)):
    verify_host(authorization)
    with LOCK:
        tick()
        standings = rankings(state['phase'] in ('reveal', 'finished'))
        output = io.StringIO()
        writer = csv.writer(output, delimiter=';')
        writer.writerow(['Puesto', 'Participante', 'Puntos', 'Aciertos', 'Tiempo correcto (s)'])
        for p in standings:
            writer.writerow([p['position'], p['name'], p['score'], p['correct'],
                             f"{p['total_ms']/1000:.2f}".replace('.', ',')])
        content = '\ufeff' + output.getvalue()
    return Response(content, media_type='text/csv; charset=utf-8', headers={
        'Content-Disposition': 'attachment; filename="ranking_quiz_clinico.csv"'})


@app.get('/api/health')
def health():
    return {'ok': True}


if __name__ == '__main__':
    import uvicorn
    print('\n' + '='*65)
    print(' QUIZ CLÍNICO LIVE')
    print(' Panel del presentador:  http://localhost:8000/host')
    print(f' Enlace para asistentes: http://{local_ip()}:8000/play')
    print(f' CLAVE DEL PRESENTADOR:  {HOST_PASSWORD}')
    print(' (Guarda la clave; no se muestra a los participantes.)')
    print('='*65 + '\n')
    uvicorn.run(app, host='0.0.0.0', port=int(os.getenv('PORT', '8000')))
