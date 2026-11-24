# Quiz Clínico Live 🩺

Una **aplicación web funcional** de tipo Kahoot, orientada a sesiones clínicas.

## Incluye

- Participantes desde móvil con **nombre o alias** (sin instalar apps).
- **QR y enlace** para entrar en la sala.
- 2–4 respuestas por pregunta, con una única correcta.
- **Control manual de avance** por parte del presentador.
- Cronómetro individual de cada pregunta (5–120 s): se **cierran automáticamente** las respuestas cuando se agota el tiempo; puedes revelar antes si lo deseas. **La siguiente pregunta no comienza hasta que pulses el botón**.
- Puntuación: **1.000 puntos por acierto + hasta 500 de bonificación por velocidad**. Respuestas incorrectas o fuera de tiempo: 0 puntos. Solo una respuesta por persona y pregunta.
- Ranking provisional al terminar cada pregunta y clasificación final.
- Editor visual para añadir, quitar, ordenar preguntas y explicaciones. Importación/exportación JSON.
- Exportación del ranking a **CSV para Excel**.

## Opción 1: iniciarlo en tu ordenador

**Requisitos:** Python 3.10 o superior, conexión al mismo Wi-Fi entre ponente y participantes y una red sin aislamiento entre dispositivos.

**Mac:** abre `INICIAR_MAC.command` (si macOS lo bloquea, clic derecho → Abrir). Si no funciona, abre Terminal en esta carpeta y ejecuta:

```bash
python3 -m pip install -r requirements.txt
python3 server.py
```

**Windows:** haz doble clic en `INICIAR_WINDOWS.bat`. O desde PowerShell:

```powershell
py -m pip install -r requirements.txt
py server.py
```

En la terminal aparecerán tres datos:

1. **Panel privado:** `http://localhost:8000/host`
2. **Enlace para participantes:** `http://[IP-de-tu-ordenador]:8000/play`
3. **Clave del presentador:** necesaria para controlar la sesión.

Abre el panel del presentador desde tu ordenador, introduce la clave, edita preguntas y proyecta la pantalla. Comparte el código QR visible para que los asistentes se unan.

> Atención: si no logran entrar mediante el QR, comprueba que todos están en la misma Wi-Fi y que el cortafuegos permite conexiones entrantes a Python en el puerto 8000. En redes hospitalarias, la Wi-Fi de invitados puede aislar los móviles; en ese caso conviene publicar la app en un servidor accesible por Internet.

## Opción 2: usarla desde cualquier móvil mediante una URL pública

La aplicación incluye un `Dockerfile` y `render.yaml` para facilitar un despliegue web. En un servicio como Render, Railway o similar, publica el proyecto y establece la variable de entorno `QUIZ_HOST_PASSWORD` con una contraseña robusta. El comando de inicio es:

```bash
uvicorn server:app --host 0.0.0.0 --port $PORT
```

Si el proveedor utiliza un puerto distinto, configúralo por entorno. Con HTTPS, puedes compartir una URL pública, sin requerir la misma Wi-Fi. El servicio gratuito o de bajo coste puede tener límites de conexiones o entrar en suspensión; comprueba la accesibilidad antes de la sesión.

## Cómo usarlo en la sesión

1. Ve a `/host` y escribe la clave.
2. En **Editar preguntas**, cambia el título y redacta las preguntas. Se incluyen 3 **preguntas de ejemplo** sobre colestasis pediátrica: revisa la adecuación clínica antes de utilizarlas.
3. Proyecta la pantalla de espera con el QR. Los asistentes entran en `/play` e introducen su nombre.
4. Pulsa **Empezar quiz**. Se presenta la pregunta y comienza el cronómetro.
5. Al agotar el tiempo (o pulsar **Revelar respuesta ahora**), todos ven la solución y la clasificación. Puedes comentar la explicación clínica.
6. Pulsa **Siguiente pregunta** cuando quieras. Al final, **Ver ranking final** y **Exportar ranking**.

## Formato JSON de preguntas

```json
{
  "title": "Mi sesión clínica",
  "questions": [
    {
      "text": "¿Cuál es el diagnóstico más probable?",
      "options": ["Opción A", "Opción B", "Opción C"],
      "correct": 1,
      "seconds": 20,
      "explanation": "Explicación opcional que aparece después de votar."
    }
  ]
}
```

**Importante:** `correct` empieza desde 0. Para A: 0; B: 1; C: 2; D: 3. Puedes introducir hasta 100 preguntas. Las nuevas preguntas quedan guardadas en `data/questions.json` en el servidor local y se conservan tras cerrar la aplicación. En alojamientos sin disco persistente, **exporta el JSON antes de detener el servidor**, porque los cambios podrían perderse.

## Privacidad, fiabilidad y límites de esta primera versión

- No introduzcas información identificativa de pacientes o familias: usa preguntas generales o casos completamente anonimizados.
- Los nombres, respuestas y puntuaciones se guardan solo en memoria durante la partida; un reinicio del servidor los borra. Exporta el ranking antes de cerrar.
- Los nombres elegidos son públicos para el resto de participantes mediante el ranking. Usa alias si es preferible.
- Hay **una sola sala por servidor** y un máximo de **300 participantes**. No es una plataforma multi-organizador ni incluye cuentas permanentes.
- Un participante puede intentar usar otro navegador o dispositivo para darse de alta con otro alias; no es un sistema antifraude para exámenes oficiales.
- La clasificación usa el tiempo medido al llegar la respuesta al servidor. La conexión a Internet puede influir ligeramente en tiempos muy próximos.
- Establece una contraseña robusta y sirve el sitio mediante HTTPS si lo haces público. No compartas la clave de presentador.
- El QR usa la dirección conocida por el servidor. Puedes fijar `QUIZ_PUBLIC_URL` (por ejemplo `https://tuquiz.example`) si tu servidor está detrás de un proxy.

## Personalizar el aspecto

Los colores y tipografías están en `static/style.css`, y las pantallas en `static/host.html`, `static/play.html`, `static/host.js` y `static/play.js`.

Desarrollado como prototipo para docencia. Antes de usarlo en una actividad con muchos asistentes, haz una prueba completa con varios móviles.
