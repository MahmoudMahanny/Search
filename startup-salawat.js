/* startup-salawat.js — play salawat once per app session on open */
(function () {
  const SESSION_KEY = 'lammahSalawatPlayed';
  const TEXT = 'صَلِّ عَلَى مُحَمَّدٍ';

  function alreadyPlayed() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
  }

  function markPlayed() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function pickArabicVoice() {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => /^ar/i.test(v.lang)) ||
      voices.find((v) => /arabic|عرب/i.test(v.name)) ||
      null;
  }

  function speakWeb() {
    if (!window.speechSynthesis) return false;
    const utter = new SpeechSynthesisUtterance(TEXT);
    utter.lang = 'ar-SA';
    utter.rate = 0.9;
    utter.pitch = 1;
    const voice = pickArabicVoice();
    if (voice) utter.voice = voice;
    utter.onend = markPlayed;
    utter.onerror = markPlayed;
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function speakNative() {
    if (!window.Capacitor?.registerPlugin) return false;
    try {
      const Salawat = window.Capacitor.registerPlugin('Salawat');
      if (!Salawat?.speak) return false;
      await Salawat.speak({ text: TEXT });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function playStartupSalawat() {
    if (alreadyPlayed()) return;
    const nativeOk = await speakNative();
    if (nativeOk) {
      markPlayed();
      return;
    }
    const startWeb = () => {
      if (speakWeb()) return;
      // No TTS available on this device/browser.
    };
    if (!window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    if (voices.length) startWeb();
    else speechSynthesis.onvoiceschanged = () => {
      speechSynthesis.onvoiceschanged = null;
      startWeb();
    };
  }

  window.LammahStartup = { playStartupSalawat, TEXT };
})();
