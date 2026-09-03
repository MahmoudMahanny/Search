package com.lammah.search;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Streams microphone PCM from Android AudioRecord to JavaScript.
 * Bypasses WebView getUserMedia when it returns Permission denied despite OS grant.
 */
@CapacitorPlugin(
    name = "MicStream",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = MicStreamPlugin.MIC) }
)
public class MicStreamPlugin extends Plugin {

    public static final String MIC = "microphone";

    private static final int SAMPLE_RATE = 16000;
    private static final int FRAME_SAMPLES = 320;

    private AudioRecord audioRecord;
    private Thread captureThread;
    private volatile boolean capturing = false;

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put(MIC, getPermissionState(MIC).toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState(MIC) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put(MIC, "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(MIC, call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put(MIC, getPermissionState(MIC) == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            requestPermissionForAlias(MIC, call, "startAfterPermission");
            return;
        }
        startCapture(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        if (getPermissionState(MIC) != PermissionState.GRANTED) {
            call.reject("Permission denied");
            return;
        }
        startCapture(call);
    }

    private synchronized void startCapture(PluginCall call) {
        if (capturing) {
            call.resolve();
            return;
        }

        int minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuf <= 0) {
            call.reject("AudioRecord not supported on this device");
            return;
        }

        int bufferSize = Math.max(minBuf, FRAME_SAMPLES * 2 * 4);
        try {
            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            );
        } catch (SecurityException ex) {
            call.reject("Permission denied");
            return;
        }

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            releaseRecord();
            call.reject("Failed to initialize microphone");
            return;
        }

        capturing = true;
        audioRecord.startRecording();

        captureThread = new Thread(this::captureLoop, "MicStreamCapture");
        captureThread.setDaemon(true);
        captureThread.start();

        call.resolve();
    }

    private void captureLoop() {
        short[] frame = new short[FRAME_SAMPLES];
        while (capturing && audioRecord != null) {
            int read = audioRecord.read(frame, 0, frame.length);
            if (read <= 0) continue;

            byte[] bytes = new byte[read * 2];
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(frame, 0, read);

            JSObject ev = new JSObject();
            ev.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            ev.put("samples", read);
            ev.put("rate", SAMPLE_RATE);
            notifyListeners("pcm", ev);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopCapture();
        call.resolve();
    }

    private synchronized void stopCapture() {
        capturing = false;
        if (captureThread != null) {
            try {
                captureThread.join(600);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            captureThread = null;
        }
        releaseRecord();
    }

    private void releaseRecord() {
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
            } catch (Exception ignored) { /* ignore */ }
            try {
                audioRecord.release();
            } catch (Exception ignored) { /* ignore */ }
            audioRecord = null;
        }
    }

    @Override
    protected void handleOnPause() {
        stopCapture();
    }

    @Override
    protected void handleOnDestroy() {
        stopCapture();
    }
}
