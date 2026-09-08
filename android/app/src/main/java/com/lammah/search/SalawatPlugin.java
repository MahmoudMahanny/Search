package com.lammah.search;

import android.speech.tts.TextToSpeech;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * Speaks the startup salawat using Android TextToSpeech (ar).
 */
@CapacitorPlugin(name = "Salawat")
public class SalawatPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private PluginCall pendingCall;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                int lang = tts.setLanguage(new Locale("ar"));
                if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.getDefault());
                }
                ttsReady = true;
                if (pendingCall != null) {
                    doSpeak(pendingCall);
                    pendingCall = null;
                }
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!ttsReady) {
            pendingCall = call;
            return;
        }
        doSpeak(call);
    }

    private void doSpeak(PluginCall call) {
        String text = call.getString("text", "صَلِّ عَلَى مُحَمَّدٍ");
        try {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lammah-salawat");
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.handleOnDestroy();
    }
}
