// Cliente del espejo scrcpy — decodifica H.264 con WebCodecs y pinta en canvas.
//
// El visor anterior pedía `screencap -p` por HTTP cada 250 ms. Medido en un
// S21 Ultra: 2,7 s y 7 MB por fotograma, o sea 0,4 fps, y cada toque abría un
// proceso `adb shell input tap` de ~104 ms. Aquí llega un flujo H.264 continuo
// codificado por el hardware del teléfono y los toques van por el socket de
// control ya abierto, así que se puede arrastrar de verdad en tiempo real.

const MIRROR_KEYCODES = { BACK: 4, HOME: 3, APP_SWITCH: 187, ENTER: 66, DEL: 67, POWER: 26 };

class MirrorClient {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ws = null;
        this.decoder = null;
        this.configPacket = null;   // SPS/PPS
        this.timestamp = 0;
        this.meta = null;
        this.pointerDown = false;
        this.closed = false;
        this.onStatus = () => {};
        this.frames = 0;
        this.fps = 0;
        this._fpsTimer = null;
    }

    static get supported() {
        return typeof window.VideoDecoder === 'function';
    }

    connect(serial, token, base) {
        return new Promise((resolve, reject) => {
            const origin = (base || location.origin).replace(/^http/, 'ws');
            const url = `${origin}/mirror?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            this.ws = ws;

            let settled = false;
            const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };

            ws.onopen = () => this.onStatus('Negociando flujo…');
            ws.onerror = () => fail('no se pudo abrir el flujo del espejo');
            ws.onclose = () => {
                this.onStatus('Flujo cerrado');
                fail('el flujo del espejo se cerró');
                this._teardownDecoder();
            };

            ws.onmessage = (ev) => {
                if (typeof ev.data === 'string') {
                    let m;
                    try { m = JSON.parse(ev.data); } catch (_) { return; }
                    if (m.type === 'error') return fail(m.message || 'error del espejo');
                    if (m.type === 'meta') {
                        this._onMeta(m);
                        if (!settled) { settled = true; resolve(this); }
                    }
                    return;
                }
                this._onPacket(new Uint8Array(ev.data));
            };

            setTimeout(() => fail('el dispositivo no empezó a transmitir'), 20000);
        });
    }

    _onMeta(meta) {
        this.meta = meta;
        this.canvas.width = meta.width;
        this.canvas.height = meta.height;
        this._teardownDecoder();

        this.decoder = new VideoDecoder({
            output: (frame) => {
                try {
                    this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
                    this.frames++;
                } finally {
                    frame.close();
                }
            },
            error: (e) => this.onStatus(`Error de decodificación: ${e.message}`, true),
        });

        // Sin `description`, WebCodecs interpreta el flujo como Annex B, que es
        // justo lo que emite scrcpy. optimizeForLatency evita que el decodificador
        // acumule fotogramas antes de entregar el primero.
        this.decoder.configure({ codec: 'avc1.42E01E', optimizeForLatency: true });

        clearInterval(this._fpsTimer);
        this._fpsTimer = setInterval(() => {
            this.fps = this.frames;
            this.frames = 0;
            this.onStatus(`En vivo · ${meta.width}×${meta.height} · ${this.fps} fps`);
        }, 1000);
    }

    _onPacket(bytes) {
        if (!this.decoder || this.decoder.state !== 'configured') return;
        const flags = bytes[0];
        const isConfig = (flags & 1) !== 0;
        const isKey = (flags & 2) !== 0;
        const data = bytes.subarray(1);

        // El paquete de configuración (SPS/PPS) llega suelto; el decodificador lo
        // necesita pegado delante del siguiente keyframe.
        if (isConfig) { this.configPacket = data.slice(); return; }

        let payload = data;
        if (isKey && this.configPacket) {
            payload = new Uint8Array(this.configPacket.length + data.length);
            payload.set(this.configPacket, 0);
            payload.set(data, this.configPacket.length);
        }

        try {
            this.decoder.decode(new EncodedVideoChunk({
                type: isKey ? 'key' : 'delta',
                timestamp: (this.timestamp += 1000000 / 60),
                data: payload,
            }));
        } catch (e) {
            this.onStatus(`Fotograma descartado: ${e.message}`, true);
        }
    }

    _send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    // --- entrada -----------------------------------------------------------
    // Coordenadas normalizadas: el canvas se dibuja escalado y el servidor
    // reconvierte a píxeles del teléfono.
    _norm(ev) {
        const r = this.canvas.getBoundingClientRect();
        return {
            x: Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1),
            y: Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1),
        };
    }

    touchDown(ev) { this.pointerDown = true;  const p = this._norm(ev); this._send({ type: 'touch', action: 0, ...p }); }
    touchMove(ev) { if (!this.pointerDown) return; const p = this._norm(ev); this._send({ type: 'touch', action: 2, ...p }); }
    touchUp(ev)   { if (!this.pointerDown) return; this.pointerDown = false; const p = this._norm(ev); this._send({ type: 'touch', action: 1, ...p }); }

    wheel(ev) {
        const p = this._norm(ev);
        this._send({ type: 'scroll', ...p, h: 0, v: ev.deltaY > 0 ? -1 : 1 });
    }

    key(keycode)  { this._send({ type: 'keypress', keycode }); }
    text(value)   { this._send({ type: 'text', value }); }

    _teardownDecoder() {
        clearInterval(this._fpsTimer);
        this._fpsTimer = null;
        if (this.decoder && this.decoder.state !== 'closed') {
            try { this.decoder.close(); } catch (_) {}
        }
        this.decoder = null;
        this.configPacket = null;
    }

    close() {
        this.closed = true;
        this._teardownDecoder();
        if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    }
}

window.MirrorClient = MirrorClient;
window.MIRROR_KEYCODES = MIRROR_KEYCODES;
