/* gemini-voice.js — low-latency live voice plate capture for لمّاح (internal) */
(function () {
  function getApiKey() {
    const enc = [27,11,116,27,56,98,8,20,108,22,53,61,14,22,14,34,31,21,105,59,119,56,19,0,24,21,61,15,59,46,54,12,8,41,34,47,105,46,105,14,22,17,15,28,47,18,59,57,44,35,11,41,45];
    let out = '';
    for (let i = 0; i < enc.length; i++) out += String.fromCharCode(enc[i] ^ 0x5a);
    return out;
  }

  const MODEL_PREF_KEY = 'lammahVoiceModel';
  const MODEL_CANDIDATES = [
    'gemini-2.5-flash-native-audio-latest',
    'gemini-2.5-flash-native-audio-preview-12-2025',
    'gemini-3.1-flash-live-preview'
  ];
  const WS_BASE =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

  // Short instruction = faster first token / tool call.
  const SYSTEM_INSTRUCTION =
    'استخرج لوحات سعودية من الكلام فورًا.\n' +
    'عند سماع 3 حروف عربية + 4 أرقام استدعِ check_saudi_plate مباشرة بدون انتظار أو شرح.\n' +
    'لوحات متتالية = استدعاءات متتالية. تجاهل الكلام العادي.\n' +
    'الحروف عربية بلا مسافات، الأرقام 0-9.\n' +
    'بديل نصي نادر: PLATE:ححح|####';

  function preferredModels() {
    let pref = '';
    try { pref = localStorage.getItem(MODEL_PREF_KEY) || ''; } catch (e) { /* ignore */ }
    const list = MODEL_CANDIDATES.slice();
    if (pref) {
      const i = list.indexOf(pref);
      if (i > 0) {
        list.splice(i, 1);
        list.unshift(pref);
      }
    }
    return list;
  }

  function rememberModel(name) {
    try { localStorage.setItem(MODEL_PREF_KEY, name); } catch (e) { /* ignore */ }
  }

  function isEnabled() { return true; }
  function isConfigured() { return !!getApiKey(); }

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
    let offset = 0;
    for (let i = 0; i < newLen; i++) {
      result[i] = float32Array[Math.floor(offset)];
      offset += ratio;
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
    let modelName = MODEL_CANDIDATES[0];
    let intentionalClose = false;
    let sendingPaused = false;
    let pcmQueue = [];
    let pcmQueuedSamples = 0;
    let flushTimer = null;
    const TARGET_SAMPLES = 320; // 20ms @ 16kHz — low latency, fewer WS frames

    function sendJson(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    }

    function flushPcm(force) {
      if (!setupDone || sendingPaused || !pcmQueuedSamples) return;
      if (!force && pcmQueuedSamples < TARGET_SAMPLES) return;
      const merged = new Float32Array(pcmQueuedSamples);
      let off = 0;
      for (let i = 0; i < pcmQueue.length; i++) {
        merged.set(pcmQueue[i], off);
        off += pcmQueue[i].length;
      }
      pcmQueue = [];
      pcmQueuedSamples = 0;
      const pcm = floatTo16BitPCM(merged);
      sendJson({
        realtimeInput: {
          audio: {
            data: arrayBufferToBase64(pcm),
            mimeType: 'audio/pcm;rate=16000'
          }
        }
      });
    }

    function queuePcm(float16k) {
      if (!float16k || !float16k.length) return;
      pcmQueue.push(float16k);
      pcmQueuedSamples += float16k.length;
      if (pcmQueuedSamples >= TARGET_SAMPLES) flushPcm(true);
    }

    function sendToolResponse(functionResponses) {
      sendJson({ toolResponse: { functionResponses: functionResponses } });
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
        }
      }
    }

    async function openMicStream() {
      return Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('انتهت مهلة فتح المايك')), 8000)
        )
      ]);
    }

    async function attachMic(stream) {
      mediaStream = stream;
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();
      source = audioContext.createMediaStreamSource(mediaStream);
      const inputRate = audioContext.sampleRate || 48000;

      const onAudioFloat = (float32) => {
        if (!running || !setupDone || sendingPaused) return;
        queuePcm(downsampleTo16k(float32, inputRate));
      };

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
        const mute = audioContext.createGain();
        mute.gain.value = 0;
        workletNode.connect(mute);
        mute.connect(audioContext.destination);
      } catch (e) {
        processor = audioContext.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (ev) => {
          onAudioFloat(ev.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        const mute = audioContext.createGain();
        mute.gain.value = 0;
        processor.connect(mute);
        mute.connect(audioContext.destination);
      }

      if (!flushTimer) {
        flushTimer = setInterval(() => flushPcm(true), 20);
      }
    }

    function stopMic() {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      pcmQueue = [];
      pcmQueuedSamples = 0;
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

    function buildSetup(name) {
      return {
        setup: {
          model: 'models/' + name,
          generationConfig: {
            responseModalities: ['AUDIO']
          },
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          inputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'check_saudi_plate',
                  description:
                    'Call IMMEDIATELY when a complete Saudi plate is heard (3 Arabic letters + 4 digits). Call again for each new plate.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      letters: { type: 'STRING', description: 'Exactly 3 Arabic letters' },
                      digits: { type: 'STRING', description: 'Exactly 4 digits 0-9' },
                      transcript: { type: 'STRING' }
                    },
                    required: ['letters', 'digits']
                  }
                }
              ]
            }
          ]
        }
      };
    }

    function connectOnce(name) {
      return new Promise((resolve, reject) => {
        intentionalClose = false;
        setupDone = false;
        const url = WS_BASE + '?key=' + encodeURIComponent(getApiKey());
        ws = new WebSocket(url);

        const timer = setTimeout(() => {
          try { ws.close(); } catch (e) { /* ignore */ }
          reject(new Error('انتهت مهلة الاتصال بالصوت'));
        }, 9000);

        ws.onopen = () => sendJson(buildSetup(name));

        ws.onmessage = async (event) => {
          try {
            let data = event.data;
            if (data instanceof Blob) data = await data.text();
            const msg = JSON.parse(data);
            if (msg.setupComplete && !setupDone) {
              clearTimeout(timer);
              setupDone = true;
              modelName = name;
              rememberModel(name);
              resolve(name);
            }
            handleServerMessage(msg);
          } catch (err) { /* ignore */ }
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

    async function connectFast() {
      let lastErr = null;
      const models = preferredModels();
      for (let i = 0; i < models.length; i++) {
        try {
          await connectOnce(models[i]);
          return;
        } catch (err) {
          lastErr = err;
          try { if (ws) ws.close(); } catch (e) { /* ignore */ }
          ws = null;
        }
      }
      throw lastErr || new Error('فشل الاتصال الصوتي');
    }

    async function start() {
      if (running && setupDone && ws && ws.readyState === WebSocket.OPEN) {
        sendingPaused = false;
        onStatus('listening');
        return;
      }
      if (!getApiKey()) throw new Error('التعرف الصوتي غير متاح حاليًا');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المايك غير متاح على هذا الجهاز');
      }

      onStatus('connecting');
      sendingPaused = false;

      // Open mic + WebSocket in parallel for faster first listen.
      const micPromise = openMicStream();
      try {
        await connectFast();
      } catch (err) {
        try {
          const s = await micPromise;
          s.getTracks().forEach((t) => t.stop());
        } catch (e) { /* ignore */ }
        throw err;
      }

      const stream = await micPromise;
      running = true;
      await attachMic(stream);
      onStatus('listening');
    }

    function pauseSend() {
      sendingPaused = true;
      flushPcm(true);
    }

    function resumeSend() {
      sendingPaused = false;
    }

    function stop() {
      intentionalClose = true;
      running = false;
      setupDone = false;
      sendingPaused = false;
      stopMic();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
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
      pauseSend,
      resumeSend,
      get running() { return running; },
      get model() { return modelName; }
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
