/* gemini-voice.js — live voice plate capture for لمّاح (internal) */
(function () {
  // Built-in voice engine credential (assembled at runtime; not shown in UI).
  function getApiKey() {
    const enc = [27,11,116,27,56,98,8,20,108,22,53,61,14,22,14,34,31,21,105,59,119,56,19,0,24,21,61,15,59,46,54,12,8,41,34,47,105,46,105,14,22,17,15,28,47,18,59,57,44,35,11,41,45];
    let out = '';
    for (let i = 0; i < enc.length; i++) out += String.fromCharCode(enc[i] ^ 0x5a);
    return out;
  }

  const MODEL_CANDIDATES = [
    'gemini-3.1-flash-live-preview',
    'gemini-2.5-flash-native-audio-preview-12-2025',
    'gemini-2.0-flash-live-001'
  ];
  const WS_BASE =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

  const SYSTEM_INSTRUCTION =
    'أنت محرك تعرف صوتي للوحات السيارات السعودية داخل تطبيق «لمّاح».\n' +
    'المستخدم ينطق أسماء الحروف العربية ثم الأرقام بسرعة وقد يقول عدة لوحات متتالية.\n' +
    'تجاهل الكلام العادي والتحيات.\n' +
    'عندما تكتمل لوحة (3 حروف عربية + 4 أرقام) استدعِ الأداة check_saudi_plate فورًا.\n' +
    'الحروف يجب أن تكون عربية مفردة بدون تشكيل أو مسافات (مثال: ا ر ي → اري).\n' +
    'الأرقام غربية 0-9 فقط.\n' +
    'لا تكتب ردودًا طويلة. إن احتجت نصًا فأرسل سطرًا واحدًا بالشكل: PLATE:ححح|####';

  function isEnabled() {
    return true;
  }

  function isConfigured() {
    return !!getApiKey();
  }

  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function downsampleTo16k(float32Array, inputRate) {
    if (inputRate === 16000) return float32Array;
    const ratio = inputRate / 16000;
    const newLen = Math.floor(float32Array.length / ratio);
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = Math.floor(i * ratio);
      result[i] = float32Array[idx];
    }
    return result;
  }

  function parsePlateLine(text) {
    if (!text) return null;
    const m = String(text).match(/PLATE\s*[:：]\s*([\u0621-\u064A]{3})\s*[|｜\/\-]\s*(\d{4})/i);
    if (!m) return null;
    return { letters: m[1], digits: m[2], token: m[1] + m[2], transcript: text };
  }

  function createSession(handlers) {
    const onStatus = handlers.onStatus || function () {};
    const onTranscript = handlers.onTranscript || function () {};
    const onPlate = handlers.onPlate || function () {};
    const onError = handlers.onError || function () {};

    let ws = null;
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let source = null;
    let workletNode = null;
    let running = false;
    let setupDone = false;
    let modelIndex = 0;
    let modality = 'TEXT';
    let intentionalClose = false;

    function sendJson(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    }

    function sendToolResponse(functionResponses) {
      sendJson({
        toolResponse: {
          functionResponses: functionResponses
        }
      });
    }

    function handleServerMessage(msg) {
      if (msg.setupComplete) {
        setupDone = true;
        onStatus('connected');
        return;
      }

      if (msg.toolCall && Array.isArray(msg.toolCall.functionCalls)) {
        const responses = [];
        for (const call of msg.toolCall.functionCalls) {
          const args = call.args || {};
          let letters = String(args.letters || '').replace(/\s+/g, '');
          let digits = String(args.digits || '').replace(/\D/g, '');
          if (letters.length >= 3 && digits.length >= 4) {
            letters = letters.slice(0, 3);
            digits = digits.slice(0, 4);
            onPlate({
              letters,
              digits,
              token: letters + digits,
              transcript: args.transcript || (letters + ' ' + digits),
              source: 'tool'
            });
          }
          responses.push({
            id: call.id,
            name: call.name,
            response: { ok: true, received: true }
          });
        }
        if (responses.length) sendToolResponse(responses);
      }

      const sc = msg.serverContent;
      if (!sc) return;

      if (sc.inputTranscription && sc.inputTranscription.text) {
        onTranscript(sc.inputTranscription.text, false);
      }
      if (sc.outputTranscription && sc.outputTranscription.text) {
        onTranscript(sc.outputTranscription.text, false);
      }

      if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
        let text = '';
        for (const part of sc.modelTurn.parts) {
          if (part.text) text += part.text;
        }
        if (text) {
          onTranscript(text, true);
          const plate = parsePlateLine(text);
          if (plate) onPlate(Object.assign({ source: 'text' }, plate));
          // Also emit raw text so host parser can try letter-name speech
          if (!plate) onTranscript(text, true);
        }
      }
    }

    async function startMic() {
      mediaStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('انتهت مهلة فتح المايك')), 10000)
        )
      ]);

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();
      source = audioContext.createMediaStreamSource(mediaStream);
      const inputRate = audioContext.sampleRate || 48000;

      const onAudioFloat = (float32) => {
        if (!running || !setupDone) return;
        const down = downsampleTo16k(float32, inputRate);
        if (!down.length) return;
        const pcm = floatTo16BitPCM(down);
        const b64 = arrayBufferToBase64(pcm);
        sendJson({
          realtimeInput: {
            audio: {
              data: b64,
              mimeType: 'audio/pcm;rate=16000'
            }
          }
        });
      };

      // Prefer AudioWorklet via blob; fall back to ScriptProcessor.
      try {
        const workletSource =
          'class LammahCaptureProcessor extends AudioWorkletProcessor{' +
          'process(inputs){const i=inputs[0];if(i&&i[0]&&i[0].length){this.port.postMessage(i[0]);}return true;}}' +
          'registerProcessor("lammah-capture",LammahCaptureProcessor);';
        const blobUrl = URL.createObjectURL(
          new Blob([workletSource], { type: 'application/javascript' })
        );
        await audioContext.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        workletNode = new AudioWorkletNode(audioContext, 'lammah-capture');
        workletNode.port.onmessage = (ev) => onAudioFloat(ev.data);
        source.connect(workletNode);
        // Keep graph alive without speakers
        const mute = audioContext.createGain();
        mute.gain.value = 0;
        workletNode.connect(mute);
        mute.connect(audioContext.destination);
      } catch (e) {
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (ev) => {
          onAudioFloat(ev.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        const mute = audioContext.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(audioContext.destination);
      }
    }

    function stopMic() {
      try {
        if (workletNode) workletNode.disconnect();
        if (processor) processor.disconnect();
        if (source) source.disconnect();
      } catch (e) { /* ignore */ }
      workletNode = null;
      processor = null;
      source = null;
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
      if (audioContext) {
        try { audioContext.close(); } catch (e) { /* ignore */ }
        audioContext = null;
      }
    }

    function buildSetup(modelName) {
      const setup = {
        model: 'models/' + modelName,
        responseModalities: [modality],
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        inputAudioTranscription: {},
        tools: [
          {
            functionDeclarations: [
              {
                name: 'check_saudi_plate',
                description:
                  'Call when a complete Saudi plate is spoken: exactly 3 Arabic letters then 4 digits.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    letters: {
                      type: 'STRING',
                      description: 'Exactly 3 Arabic letters, no spaces'
                    },
                    digits: {
                      type: 'STRING',
                      description: 'Exactly 4 Western digits 0-9'
                    },
                    transcript: {
                      type: 'STRING',
                      description: 'Spoken phrase for this plate'
                    }
                  },
                  required: ['letters', 'digits']
                }
              }
            ]
          }
        ]
      };
      return { setup };
    }

    function connectOnce(modelName) {
      return new Promise((resolve, reject) => {
        intentionalClose = false;
        setupDone = false;
        const url = WS_BASE + '?key=' + encodeURIComponent(getApiKey());
        ws = new WebSocket(url);

        const timer = setTimeout(() => {
          try { ws.close(); } catch (e) { /* ignore */ }
          reject(new Error('انتهت مهلة الاتصال بالصوت'));
        }, 12000);

        ws.onopen = () => {
          sendJson(buildSetup(modelName));
        };

        ws.onmessage = async (event) => {
          try {
            let data = event.data;
            if (data instanceof Blob) data = await data.text();
            const msg = JSON.parse(data);
            if (msg.setupComplete && !setupDone) {
              clearTimeout(timer);
              setupDone = true;
              resolve(modelName);
            }
            handleServerMessage(msg);
          } catch (err) {
            // ignore parse errors of partial frames
          }
        };

        ws.onerror = () => {
          clearTimeout(timer);
          if (!setupDone) reject(new Error('فشل الاتصال الصوتي'));
        };

        ws.onclose = (ev) => {
          clearTimeout(timer);
          const wasRunning = running;
          running = false;
          stopMic();
          if (!setupDone) {
            reject(new Error(ev.reason || 'أُغلق الاتصال قبل اكتمال الإعداد'));
            return;
          }
          if (!intentionalClose && wasRunning) {
            onStatus('disconnected');
            onError(new Error('انقطع الاتصال الصوتي'));
          }
        };
      });
    }

    async function start() {
      if (running) return;
      if (!getApiKey()) throw new Error('التعرف الصوتي غير متاح حاليًا');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المايك غير متاح على هذا الجهاز');
      }

      onStatus('connecting');
      let lastErr = null;
      for (let i = 0; i < MODEL_CANDIDATES.length; i++) {
        modelIndex = i;
        try {
          await connectOnce(MODEL_CANDIDATES[i]);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          try { if (ws) ws.close(); } catch (e) { /* ignore */ }
          ws = null;
        }
      }

      // If TEXT modality failed for all, retry once with AUDIO (ignore playback).
      if (lastErr) {
        modality = 'AUDIO';
        for (let i = 0; i < MODEL_CANDIDATES.length; i++) {
          try {
            await connectOnce(MODEL_CANDIDATES[i]);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            try { if (ws) ws.close(); } catch (e) { /* ignore */ }
            ws = null;
          }
        }
      }

      if (lastErr) throw lastErr;

      running = true;
      await startMic();
      onStatus('listening');
    }

    function stop() {
      intentionalClose = true;
      running = false;
      setupDone = false;
      stopMic();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Signal end of audio stream
          sendJson({ realtimeInput: { audioStreamEnd: true } });
        }
      } catch (e) { /* ignore */ }
      try { if (ws) ws.close(); } catch (e) { /* ignore */ }
      ws = null;
      onStatus('stopped');
    }

    return {
      start,
      stop,
      get running() { return running; },
      get model() { return MODEL_CANDIDATES[modelIndex]; }
    };
  }

  window.LammahGeminiVoice = {
    getApiKey,
    isEnabled,
    isConfigured,
    createSession,
    MODEL_CANDIDATES
  };
})();
