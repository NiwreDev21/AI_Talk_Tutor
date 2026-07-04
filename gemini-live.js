/* =============================================
   ECHO — AI Tutor
   gemini-live.js — Gemini Live API (Multimodal Live)
   Real-time, low-latency voice conversation client.
   Docs: https://ai.google.dev/gemini-api/docs/live-api
   ============================================= */

'use strict';

// ---- Model / endpoint ----
// If Google rotates this model id, update it here (or in the Settings
// tab's "AI Tutor" field, which lets the user override it at runtime).
const GEMINI_LIVE_DEFAULT_MODEL = 'models/gemini-3.1-flash-live-preview';
const GEMINI_LIVE_WS_HOST = 'generativelanguage.googleapis.com';
const GEMINI_LIVE_WS_PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT = `You are Aria, a warm, patient, encouraging English conversation tutor inside a language-learning app called Echo.
Have a natural, real-time spoken conversation in English with the learner to help them practice speaking and listening.
Keep your replies short and conversational (1-3 sentences), ask a natural follow-up question to keep the conversation going, and gently model correct English when the learner makes a mistake by naturally repeating the correct phrase back — without being harsh or overly formal about it.
Always speak in English, use a friendly and relaxed tone, and adapt your vocabulary to sound like a supportive, real conversation partner rather than a lecturer.`;

// ============ AUDIO HELPERS ============

function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsampleBuffer(buffer, inRate, outRate) {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = binary.charCodeAt(i);
  return new Int16Array(buf);
}

// ============ GEMINI LIVE CLIENT ============

class GeminiLiveClient {
  constructor() {
    this.ws = null;
    this.status = 'idle'; // idle | connecting | connected | listening | speaking | error | closed
    this.micStream = null;
    this.inputCtx = null;
    this.processor = null;
    this.micActive = false;
    this.outputCtx = null;
    this.nextStartTime = 0;
    this.scheduledSources = [];
    this.setupComplete = false;

    // Callbacks — assign from the outside
    this.onStatus = null;      // (status) => void
    this.onUserText = null;    // (text, isFinal) => void
    this.onModelText = null;   // (text, isFinal) => void
    this.onError = null;       // (message) => void
    this.onClose = null;       // () => void
  }

  _setStatus(s) {
    this.status = s;
    if (this.onStatus) this.onStatus(s);
  }

  async connect({ mode = 'own', apiKey, model, systemInstruction, voiceName = 'Puck', tokenEndpoint = '/api/gemini-token' }) {
    this.mode = mode;
    let wsUrl;

    if (mode === 'developer') {
      // "Talk To Me AI Free" — ask our own backend for a short-lived
      // token instead of ever touching the developer's real API key.
      this._setStatus('connecting');
      let tokenData;
      try {
        const tokenResp = await fetch(tokenEndpoint, { method: 'POST' });
        tokenData = await tokenResp.json().catch(() => ({}));
        if (!tokenResp.ok || !tokenData.token) {
          throw new Error(tokenData.error || 'The free AI Tutor service is unavailable right now.');
        }
      } catch (err) {
        this._setStatus('error');
        throw new Error(err.message || 'Could not reach the AI Tutor service.');
      }
      // Ephemeral tokens are only valid on the v1alpha "Constrained" endpoint.
      wsUrl = `wss://${GEMINI_LIVE_WS_HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(tokenData.token)}`;
    } else {
      // "Mi API de Gemini" — the user's own key, used directly from the browser.
      if (!apiKey) throw new Error('Missing Gemini API key');
      this._setStatus('connecting');
      wsUrl = `wss://${GEMINI_LIVE_WS_HOST}${GEMINI_LIVE_WS_PATH}?key=${encodeURIComponent(apiKey)}`;
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'blob';

      const settleReject = (err) => {
        this._setStatus('error');
        reject(err);
      };

      this.ws.onopen = () => {
        const setupMsg = {
          setup: {
            model: model || GEMINI_LIVE_DEFAULT_MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstruction || GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        };
        this.ws.send(JSON.stringify(setupMsg));
      };

      this.ws.onerror = () => {
        const msg = mode === 'developer'
          ? 'Connection error reaching the free AI Tutor service.'
          : 'Connection error. Check your API key and network.';
        settleReject(new Error(msg));
        if (this.onError) this.onError(msg);
      };

      this.ws.onclose = (ev) => {
        this._setStatus('closed');
        if (!this.setupComplete) {
          const reason = ev.reason ? ` — ${ev.reason}` : '';
          settleReject(new Error(`Connection closed before setup completed (code ${ev.code}${reason})`));
        }
        if (this.onClose) this.onClose();
      };

      this.ws.onmessage = async (event) => {
        let raw = event.data;
        if (raw instanceof Blob) raw = await raw.text();
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        if (msg.error) {
          const errMsg = msg.error.message || JSON.stringify(msg.error);
          settleReject(new Error(errMsg));
          if (this.onError) this.onError(errMsg);
          return;
        }

        if (msg.setupComplete) {
          this.setupComplete = true;
          this._setStatus('connected');
          resolve();
          return;
        }

        if (msg.serverContent) {
          const sc = msg.serverContent;

          if (sc.interrupted) {
            this._clearPlaybackQueue();
          }

          if (sc.inputTranscription && typeof sc.inputTranscription.text === 'string') {
            if (this.onUserText) this.onUserText(sc.inputTranscription.text, false);
          }

          if (sc.outputTranscription && typeof sc.outputTranscription.text === 'string') {
            if (this.onModelText) this.onModelText(sc.outputTranscription.text, false);
          }

          if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData && part.inlineData.data) {
                this._playAudioChunk(part.inlineData.data);
              }
            }
          }

          if (sc.turnComplete) {
            if (this.onUserText) this.onUserText('', true);
            if (this.onModelText) this.onModelText('', true);
          }
        }

        if (msg.goAway) {
          if (this.onError) this.onError('Session will end soon (server going away).');
        }
      };
    });
  }

  // ---- Mic capture (client -> Gemini) ----
  async startMic() {
    if (this.micActive) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const AC = window.AudioContext || window.webkitAudioContext;
    this.inputCtx = new AC();
    const source = this.inputCtx.createMediaStreamSource(this.micStream);

    const bufferSize = 4096;
    this.processor = this.inputCtx.createScriptProcessor(bufferSize, 1, 1);
    const silentGain = this.inputCtx.createGain();
    silentGain.gain.value = 0;

    this.processor.onaudioprocess = (e) => {
      if (!this.micActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const down = downsampleBuffer(input, this.inputCtx.sampleRate, 16000);
      const pcm16 = floatTo16BitPCM(down);
      const b64 = arrayBufferToBase64(pcm16.buffer);
      this.ws.send(JSON.stringify({
        realtimeInput: {
          audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
        },
      }));
    };

    source.connect(this.processor);
    this.processor.connect(silentGain);
    silentGain.connect(this.inputCtx.destination);

    this.micActive = true;
    this._setStatus('listening');
  }

  stopMic() {
    this.micActive = false;
    if (this.processor) { try { this.processor.disconnect(); } catch (e) {} this.processor = null; }
    if (this.inputCtx) { try { this.inputCtx.close(); } catch (e) {} this.inputCtx = null; }
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    }
    if (this.status === 'listening') this._setStatus('connected');
  }

  // ---- Playback (Gemini -> speakers) ----
  _ensureOutputCtx() {
    if (this.outputCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.outputCtx = new AC({ sampleRate: 24000 });
    } catch (e) {
      this.outputCtx = new AC();
    }
    this.nextStartTime = 0;
  }

  _playAudioChunk(base64) {
    this._ensureOutputCtx();
    const int16 = base64ToInt16Array(base64);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const ctx = this.outputCtx;
    const audioBuffer = ctx.createBuffer(1, float32.length, ctx.sampleRate === 24000 ? 24000 : ctx.sampleRate);
    // If the context couldn't be created at 24kHz, we still copy raw samples;
    // most browsers honor the requested sampleRate so this is the common path.
    audioBuffer.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;

    this.scheduledSources.push(src);
    this._setStatus('speaking');
    src.onended = () => {
      this.scheduledSources = this.scheduledSources.filter(s => s !== src);
      if (this.scheduledSources.length === 0) {
        this._setStatus(this.micActive ? 'listening' : 'connected');
      }
    };
  }

  _clearPlaybackQueue() {
    this.scheduledSources.forEach(s => { try { s.stop(); } catch (e) {} });
    this.scheduledSources = [];
    if (this.outputCtx) this.nextStartTime = this.outputCtx.currentTime;
  }

  disconnect() {
    this.stopMic();
    this._clearPlaybackQueue();
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.outputCtx) { try { this.outputCtx.close(); } catch (e) {} this.outputCtx = null; }
    this.setupComplete = false;
    this._setStatus('idle');
  }
}

window.GeminiLiveClient = GeminiLiveClient;
window.GEMINI_LIVE_DEFAULT_MODEL = GEMINI_LIVE_DEFAULT_MODEL;
window.GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT = GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT;