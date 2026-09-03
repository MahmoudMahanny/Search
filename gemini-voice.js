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

  const SYSTEM_INSTRUCTION_BASE =
    'أنت مساعد صوتي لاستخراج لوحات المركبات السعودية فقط — ليس للكلام العام.\n' +
    'القاعدة: 3 حروف عربية (من الأبجدية العربية \u0621-\u064A) + 4 أرقام لاتينية 0-9.\n' +
    'مثال صحيح: عبق3847، راد2646، اصس7743.\n' +
    'ممنوع: العبري، الإنجليزي، الشرح، الترجمة، أو أي لغة غير العربية السعودية.\n' +
    'ممنوع كتابة transcription بالحروف العبرية (\u0590-\u05FF) — إذا سمعت صوتاً مشوشاً حوّله لأقرب حروف عربية سعودية للوحة.\n' +
    'الأرقام دائماً 0-9 (ليست ٠١٢٣ العربية الشرقية).\n' +
    'عند اكتمال لوحة (3 حروف + 4 أرقام) استدعِ check_saudi_plate فوراً بدون انتظار.\n' +
    'لوحات متتالية = استدعاءات متتالية. تجاهل الكلام العادي والضجيج.\n' +
    'لا تنتظر نهاية الجملة — أطلق الأداة بمجرد اكتمال السبعة رموز.\n' +
    'بديل نصي نادر فقط: PLATE:ححح|####';

  const ARABIC_LETTER_RE = /[\u0621-\u064A]/;
  const ARABIC_PLATE_LETTERS_RE = /^[\u0621-\u064A]{3}$/;
  const HEBREW_RE = /[\u0590-\u05FF]/;

  function getPlateSamples() {
    try {
      const samples = typeof window !== 'undefined' && window.LAMMAH_GEMINI_PLATE_SAMPLES;
      if (Array.isArray(samples) && samples.length) return samples;
    } catch (e) { /* ignore */ }
    return [];
  }

  function buildSystemInstruction() {
    const samples = getPlateSamples();
    if (!samples.length) return SYSTEM_INSTRUCTION_BASE;
    return (
      SYSTEM_INSTRUCTION_BASE +
      '\n\nقائمة مرجعية: ' + samples.length + ' لوحة سعودية حقيقية — استخدمها لفهم نطق الحروف والأنماط:\n' +
      samples.join('، ') +
      '\n\nتذكير: كل الحروف في الأمثلة عربية. لا تُخرِج عبرية أبداً.'
    );
  }

  function sanitizePlateLetters(raw) {
    return String(raw || '')
      .replace(/\s+/g, '')
      .split('')
      .filter((ch) => ARABIC_LETTER_RE.test(ch))
      .join('')
      .slice(0, 3);
  }

  function sanitizePlateDigits(raw) {
    return String(raw || '').replace(/\D/g, '').slice(0, 4);
  }

  function isAcceptableTranscript(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (HEBREW_RE.test(t)) return false;
    return true;
  }

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

  function wsStateLabel(ws) {
    if (!ws) return 'none';
    if (ws.readyState === WebSocket.CONNECTING) return 'connecting';
    if (ws.readyState === WebSocket.OPEN) return 'open';
    if (ws.readyState === WebSocket.CLOSING) return 'closing';
    return 'closed';
  }

  function formatCloseReason(ev) {
    const code = ev && ev.code ? ev.code : 0;
    const reason = ev && ev.reason ? String(ev.reason).trim() : '';
    const map = {
      1000: 'إغلاق طبيعي من الخادم',
      1001: 'الخادم أغلق الاتصال (مغادرة)',
      1006: 'انقطاع مفاجئ — غالبًا شبكة أو خلفية التطبيق',
      1008: 'الخادم رفض الطلب (سياسة/مفتاح)',
      1011: 'خطأ داخلي في الخادم',
      1012: 'الخدمة غير متاحة مؤقتًا',
      1013: 'حمل زائد على الخادم'
    };
    const base = map[code] || ('انقطع الاتصال (كود ' + code + ')');
    return reason ? base + ' — ' + reason : base;
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
    const onSpeechActivity = handlers.onSpeechActivity || function () {};
    const onEvent = handlers.onEvent || function () {};

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
    let healthTimer = null;
    let reconnectTimer = null;
    let reconnecting = false;
    let reconnectAttempts = 0;
    let lastPcmSentAt = 0;
    let lastServerMsgAt = 0;
    let lastIssue = '';
    const TARGET_SAMPLES = 320;
    let micSource = 'none'; // 'webview' | 'native' | 'none'
    let nativeMicActive = false;
    let nativeMicListener = null;
    let nativeMicPlugin = null;
    let lastNativeActivityTime = 0;
    let micWarmupUntil = 0;

    function isCapacitorAndroid() {
      try {
        return !!(
          window.Capacitor &&
          window.Capacitor.isNativePlatform &&
          window.Capacitor.isNativePlatform() &&
          window.Capacitor.getPlatform &&
          window.Capacitor.getPlatform() === 'android'
        );
      } catch (e) {
        return false;
      }
    }

    function getMicStreamPlugin() {
      if (!nativeMicPlugin && window.Capacitor && window.Capacitor.registerPlugin) {
        nativeMicPlugin = window.Capacitor.registerPlugin('MicStream');
      }
      return nativeMicPlugin;
    }

    function int16Base64ToFloat32(base64, samples) {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const view = new DataView(bytes.buffer);
      const out = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        out[i] = view.getInt16(i * 2, true) / 0x8000;
      }
      return out;
    }

    function emitEvent(type, detail) {
      try { onEvent(type, detail || {}); } catch (e) { /* ignore */ }
    }

    function noteIssue(msg) {
      lastIssue = String(msg || '');
      emitEvent('issue', { message: lastIssue });
    }

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
      lastPcmSentAt = Date.now();
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
      lastServerMsgAt = Date.now();
      if (msg.setupComplete) {
        setupDone = true;
        onStatus('connected');
        emitEvent('setup_complete', { model: modelName });
        return;
      }

      if (msg.toolCall && Array.isArray(msg.toolCall.functionCalls)) {
        const responses = [];
        for (const call of msg.toolCall.functionCalls) {
          const args = call.args || {};
          let letters = sanitizePlateLetters(args.letters);
          let digits = sanitizePlateDigits(args.digits);
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
        const t = sc.inputTranscription.text;
        if (isAcceptableTranscript(t)) onTranscript(t, false);
      }
      if (sc.outputTranscription && sc.outputTranscription.text) {
        const t = sc.outputTranscription.text;
        if (isAcceptableTranscript(t)) onTranscript(t, false);
      }

      if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
        let text = '';
        for (const part of sc.modelTurn.parts) {
          if (part.text) text += part.text;
        }
        if (text && isAcceptableTranscript(text)) {
          onTranscript(text, true);
          const plate = parsePlateLine(text);
          if (plate) onPlate(Object.assign({ source: 'text' }, plate));
        }
      }
    }

    function micTrackState() {
      if (nativeMicActive) return 'live';
      if (!mediaStream) return 'none';
      const tracks = mediaStream.getAudioTracks();
      if (!tracks.length) return 'none';
      const t = tracks[0];
      if (t.readyState === 'ended') return 'ended';
      if (t.muted) return 'muted';
      if (!t.enabled) return 'disabled';
      return 'live';
    }

    function getDiagnostics() {
      return {
        running,
        setupDone,
        reconnecting,
        reconnectAttempts,
        model: modelName,
        ws: wsStateLabel(ws),
        audioContext: nativeMicActive ? 'native' : (audioContext ? audioContext.state : 'none'),
        micTrack: micTrackState(),
        micSource,
        sendingPaused,
        lastPcmSentAt,
        lastServerMsgAt,
        lastIssue
      };
    }

    function markMicWarmup() {
      micWarmupUntil = Date.now() + 3000;
    }

    function feedPcmFloat(float32) {
      if (!running || sendingPaused || !float32 || !float32.length) return;
      const inWarmup = Date.now() < micWarmupUntil;
      let sum = 0;
      const step = Math.max(1, Math.floor(float32.length / 32));
      let count = 0;
      for (let i = 0; i < float32.length; i += step) {
        sum += Math.abs(float32[i]);
        count++;
      }
      const avg = count > 0 ? sum / count : 0;
      const activityThreshold = inWarmup ? 0.045 : 0.012;
      if (avg > activityThreshold) {
        const now = Date.now();
        if (now - lastNativeActivityTime > 400) {
          lastNativeActivityTime = now;
          try { onSpeechActivity(); } catch (e) { /* ignore */ }
        }
      }
      if (!setupDone) return;
      queuePcm(float32);
    }

    async function attachNativeMic(plugin) {
      if (nativeMicListener) {
        try { await nativeMicListener.remove(); } catch (e) { /* ignore */ }
        nativeMicListener = null;
      }
      nativeMicListener = await plugin.addListener('pcm', (ev) => {
        if (!ev || !ev.data) return;
        const samples = ev.samples || 0;
        if (!samples) return;
        feedPcmFloat(int16Base64ToFloat32(ev.data, samples));
      });
      await plugin.start();
      nativeMicActive = true;
      micSource = 'native';
      if (!flushTimer) {
        flushTimer = setInterval(() => flushPcm(true), 20);
      }
      emitEvent('mic_attached', { audioContext: 'native', micTrack: 'live', source: 'native' });
      markMicWarmup();
    }

    async function openNativeMicStream() {
      const plugin = getMicStreamPlugin();
      if (!plugin) throw new Error('MicStream plugin unavailable');

      let perm = await plugin.checkPermissions();
      if (perm.microphone !== 'granted') {
        perm = await plugin.requestPermissions();
      }
      if (perm.microphone !== 'granted') {
        throw new Error('Permission denied — إذن المايك مرفوض من النظام');
      }

      await attachNativeMic(plugin);
      emitEvent('mic_opened', { source: 'native' });
      return { __native: true };
    }

    async function openWebMicStream() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المايك غير متاح على هذا الجهاز');
      }
      const attempts = [
        { audio: true },
        {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        }
      ];
      let lastErr = null;
      for (let i = 0; i < attempts.length; i++) {
        try {
          const stream = await Promise.race([
            navigator.mediaDevices.getUserMedia(attempts[i]),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('انتهت مهلة فتح المايك')), 8000)
            )
          ]);
          const tracks = stream.getAudioTracks();
          if (!tracks.length) {
            stream.getTracks().forEach((t) => t.stop());
            lastErr = new Error('تم فتح المايك بدون مسار صوت');
            continue;
          }
          micSource = 'webview';
          emitEvent('mic_opened', { tracks: tracks.length, label: tracks[0].label || '', source: 'webview' });
          return stream;
        } catch (err) {
          lastErr = err;
          const msg = String(err && err.message ? err.message : err);
          emitEvent('mic_open_failed', { error: msg, attempt: i + 1 });
        }
      }
      const msg = String(lastErr && lastErr.message ? lastErr.message : lastErr || '');
      if (/permission|denied|notallowed/i.test(msg)) {
        throw new Error(
          'Permission denied — من إعدادات أندرويد: التطبيقات → لمّاح → الأذونات → الميكروفون ← اسمح، ثم اقفل التطبيق وافتحه تاني'
        );
      }
      throw lastErr || new Error('تعذر فتح المايك');
    }

    async function openMicStream() {
      let webErr = null;
      try {
        return await openWebMicStream();
      } catch (err) {
        webErr = err;
        const msg = String(err && err.message ? err.message : err);
        emitEvent('webview_mic_failed', { error: msg });
      }

      // WebView failed (often Permission denied) — try native AudioRecord on Android.
      if (isCapacitorAndroid()) {
        try {
          emitEvent('mic_fallback_native', {});
          return await openNativeMicStream();
        } catch (nativeErr) {
          const msg = String(nativeErr && nativeErr.message ? nativeErr.message : nativeErr);
          emitEvent('native_mic_failed', { error: msg });
        }
      }

      throw webErr || new Error('تعذر فتح المايك');
    }

    function watchMicTrack(track) {
      if (!track) return;
      track.onended = () => {
        if (!running || intentionalClose) return;
        const msg = 'مسار المايك توقف — سأعيد فتحه تلقائيًا';
        noteIssue(msg);
        emitEvent('mic_ended', {});
        scheduleReconnect(msg);
      };
      track.onmute = () => {
        if (!running || intentionalClose) return;
        noteIssue('المايك مكتوم من النظام');
        emitEvent('mic_muted', {});
      };
    }

    async function attachMic(stream) {
      if (!stream) throw new Error('لا يوجد بث مايك');
      if (stream.__native) return;
      if (mediaStream && mediaStream !== stream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
      mediaStream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('مسار المايك غير موجود');
      watchMicTrack(track);
      try { track.enabled = true; } catch (e) { /* ignore */ }

      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch (e) { /* ignore */ }
      }
      if (audioContext.state !== 'running') {
        try { await audioContext.resume(); } catch (e) { /* ignore */ }
      }

      try {
        if (workletNode) workletNode.disconnect();
        if (processor) processor.disconnect();
        if (source) source.disconnect();
      } catch (e) { /* ignore */ }
      workletNode = null;
      processor = null;
      source = null;

      source = audioContext.createMediaStreamSource(mediaStream);
      const inputRate = audioContext.sampleRate || 48000;

      const onAudioFloat = (float32) => {
        if (!running || sendingPaused || !float32 || !float32.length) return;
        feedPcmFloat(downsampleTo16k(float32, inputRate));
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
      if (micTrackState() !== 'live') {
        throw new Error('المايك لم يصبح جاهزًا بعد الربط');
      }
      emitEvent('mic_attached', { audioContext: audioContext.state, micTrack: micTrackState() });
      markMicWarmup();
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
      if (nativeMicListener) {
        try { nativeMicListener.remove(); } catch (e) { /* ignore */ }
        nativeMicListener = null;
      }
      if (nativeMicPlugin) {
        nativeMicPlugin.stop().catch(() => {});
      }
      nativeMicActive = false;
      micSource = 'none';
      if (audioContext) {
        try { audioContext.close(); } catch (e) { /* ignore */ }
        audioContext = null;
      }
    }

    function closeWs() {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          sendJson({ realtimeInput: { audioStreamEnd: true } });
        }
      } catch (e) { /* ignore */ }
      try { if (ws) ws.close(); } catch (e) { /* ignore */ }
      ws = null;
      setupDone = false;
    }

    function buildSetup(name) {
      return {
        setup: {
          model: 'models/' + name,
          generationConfig: {
            responseModalities: ['AUDIO']
          },
          systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
          inputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'check_saudi_plate',
                  description:
                    'Call IMMEDIATELY when a complete Saudi plate is heard: exactly 3 Arabic letters (\\u0621-\\u064A) + 4 digits (0-9). Never Hebrew. Call again for each new plate.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      letters: { type: 'STRING', description: 'Exactly 3 Arabic letters only (Saudi plate alphabet)' },
                      digits: { type: 'STRING', description: 'Exactly 4 Western digits 0-9' },
                      transcript: { type: 'STRING', description: 'Arabic transcript only — never Hebrew' }
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
        closeWs();
        intentionalClose = false;
        const url = WS_BASE + '?key=' + encodeURIComponent(getApiKey());
        ws = new WebSocket(url);
        emitEvent('ws_connecting', { model: name });

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
          const wasSetup = setupDone;
          setupDone = false;
          ws = null;
          if (!wasSetup) {
            reject(new Error(formatCloseReason(ev)));
            return;
          }
          if (!intentionalClose && running) {
            onUnexpectedDisconnect(ev);
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
          emitEvent('ws_connected', { model: models[i] });
          return;
        } catch (err) {
          lastErr = err;
          emitEvent('ws_failed', { model: models[i], error: String(err.message || err) });
        }
      }
      throw lastErr || new Error('فشل الاتصال الصوتي');
    }

    async function ensureMicReady() {
      const trackOk = micTrackState() === 'live';
      if (!trackOk) {
        emitEvent('mic_reopen', {});
        stopMic();
        const stream = await openMicStream();
        if (!stream.__native) await attachMic(stream);
        return;
      }
      if (nativeMicActive && !nativeMicListener) {
        const plugin = getMicStreamPlugin();
        if (plugin) await attachNativeMic(plugin);
        return;
      }
      if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
          emitEvent('audio_resumed', { state: audioContext.state });
        } catch (e) {
          noteIssue('تعذر إيقاظ مسار الصوت — ' + (e.message || e));
        }
      }
      if (!source || (!workletNode && !processor)) {
        await attachMic(mediaStream);
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(reason) {
      if (intentionalClose || !running || reconnecting) return;
      const msg = String(reason || 'انقطع الاتصال الصوتي');
      noteIssue(msg);
      onStatus('reconnecting');
      onError(new Error(msg + ' — جارٍ إعادة الاتصال تلقائيًا'));
      emitEvent('reconnect_scheduled', { reason: msg, attempt: reconnectAttempts + 1 });

      clearReconnectTimer();
      const delay = Math.min(350 + reconnectAttempts * 500, 5500);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        attemptReconnect(msg);
      }, delay);
    }

    async function attemptReconnect(reason) {
      if (intentionalClose || !running) return;
      if (reconnecting) return;
      reconnecting = true;
      reconnectAttempts++;
      emitEvent('reconnecting', { attempt: reconnectAttempts, reason });

      try {
        await ensureMicReady();
        await connectFast();
        reconnectAttempts = 0;
        reconnecting = false;
        lastIssue = '';
        onStatus('listening');
        emitEvent('reconnected', {});
      } catch (err) {
        reconnecting = false;
        const errMsg = String(err && err.message ? err.message : err);
        noteIssue('فشل إعادة الاتصال: ' + errMsg);
        emitEvent('reconnect_failed', { error: errMsg, attempt: reconnectAttempts });
        scheduleReconnect(errMsg);
      }
    }

    function onUnexpectedDisconnect(ev) {
      if (intentionalClose || !running) return;
      const reason = formatCloseReason(ev);
      emitEvent('ws_closed', { code: ev.code, reason: reason });
      scheduleReconnect(reason);
    }

    function startHealthWatch() {
      if (healthTimer) return;
      healthTimer = setInterval(async () => {
        if (!running || intentionalClose) return;

        const diag = getDiagnostics();
        emitEvent('health', diag);

        if (diag.audioContext === 'suspended') {
          noteIssue('مسار الصوت موقوف — أحاول إيقاظه');
          try {
            if (audioContext) await audioContext.resume();
            emitEvent('audio_resumed', { state: audioContext ? audioContext.state : 'none' });
          } catch (e) {
            scheduleReconnect('مسار الصوت موقوف');
            return;
          }
        }

        if (diag.micTrack === 'ended' || diag.micTrack === 'none') {
          noteIssue('المايك غير مربوط — أعيد فتحه');
          try {
            await ensureMicReady();
            emitEvent('mic_recovered', { micTrack: micTrackState(), audioContext: audioContext ? audioContext.state : 'none' });
          } catch (e) {
            scheduleReconnect('فشل إعادة فتح المايك');
          }
          return;
        }

        if (diag.audioContext === 'none' && running) {
          noteIssue('مسار الصوت غير موجود — أعيد ربط المايك');
          try {
            await ensureMicReady();
          } catch (e) {
            scheduleReconnect('فشل إعادة ربط مسار الصوت');
          }
          return;
        }

        if (setupDone && diag.ws !== 'open') {
          scheduleReconnect('انقطع اتصال الخادم أثناء الاستماع');
          return;
        }

        if (setupDone && lastPcmSentAt && Date.now() - lastPcmSentAt > 12000) {
          noteIssue('لا يُرسل صوت منذ 12 ثانية — أعيد الاتصال');
          scheduleReconnect('توقف إرسال الصوت');
        }
      }, 2000);
    }

    function stopHealthWatch() {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
    }

    async function connectFastWithWatch() {
      await connectFast();
    }

    async function start() {
      if (running && setupDone && ws && ws.readyState === WebSocket.OPEN) {
        sendingPaused = false;
        try {
          await ensureMicReady();
        } catch (e) {
          noteIssue('الاتصال موجود لكن المايك توقف — ' + (e.message || e));
          scheduleReconnect(String(e.message || e));
          return;
        }
        onStatus('listening');
        emitEvent('already_running', getDiagnostics());
        return;
      }
      if (!getApiKey()) throw new Error('التعرف الصوتي غير متاح حاليًا');
      const canWebMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      if (!canWebMic && !isCapacitorAndroid()) {
        throw new Error('المايك غير متاح على هذا الجهاز');
      }

      intentionalClose = false;
      running = true;
      onStatus('connecting');
      sendingPaused = false;
      reconnectAttempts = 0;
      reconnecting = false;
      clearReconnectTimer();

      // Mic FIRST — if permission/capture fails, don't leave a half-open WS.
      let stream;
      try {
        stream = await openMicStream();
        if (!stream.__native) await attachMic(stream);
        emitEvent('mic_ready_before_ws', getDiagnostics());
      } catch (err) {
        running = false;
        stopMic();
        throw err;
      }

      try {
        await connectFastWithWatch();
      } catch (err) {
        running = false;
        stopMic();
        throw err;
      }

      // Re-assert mic after WS setup (some Android WebViews suspend audio during connect).
      try {
        await ensureMicReady();
      } catch (err) {
        running = false;
        closeWs();
        stopMic();
        throw err;
      }

      startHealthWatch();
      onStatus('listening');
      emitEvent('listening_ready', getDiagnostics());
      if (micTrackState() !== 'live') {
        noteIssue('المايك ما زال غير جاهز بعد الاتصال');
        scheduleReconnect('المايك غير جاهز بعد الاتصال');
      }
    }

    function pauseSend() {
      sendingPaused = true;
      flushPcm(true);
    }

    function resumeSend() {
      sendingPaused = false;
    }

    async function resumeAfterBackground() {
      if (!running || intentionalClose) return;
      emitEvent('app_visible', {});
      try {
        await ensureMicReady();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          await connectFastWithWatch();
        }
        onStatus('listening');
      } catch (err) {
        scheduleReconnect(String(err.message || err));
      }
    }

    function stop() {
      intentionalClose = true;
      running = false;
      reconnecting = false;
      reconnectAttempts = 0;
      sendingPaused = false;
      clearReconnectTimer();
      stopHealthWatch();
      closeWs();
      stopMic();
      lastIssue = '';
      onStatus('stopped');
      emitEvent('stopped', {});
    }

    return {
      start,
      stop,
      pauseSend,
      resumeSend,
      resumeAfterBackground,
      getDiagnostics,
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
