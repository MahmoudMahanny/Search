package com.lammah.search;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Capacitor's WebView getUserMedia asks for AUDIO_CAPTURE via WebChromeClient.
 * If RECORD_AUDIO was already granted (e.g. via SpeechRecognition), we must
 * grant the WebView request immediately — otherwise a second permission launcher
 * race often ends as "Permission denied" in JS while the OS permission looks granted.
 */
public class MainActivity extends BridgeActivity {
    private static final int MIC_REQ = 9911;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureMicPermission();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() == null || getBridge().getWebView() == null) return;

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                final String[] resources = request.getResources();
                boolean wantsAudio = false;
                boolean wantsVideo = false;
                for (String resource : resources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        wantsAudio = true;
                    }
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                        wantsVideo = true;
                    }
                }

                boolean audioOk = !wantsAudio || hasPermission(Manifest.permission.RECORD_AUDIO);
                boolean videoOk = !wantsVideo || hasPermission(Manifest.permission.CAMERA);

                if ((wantsAudio || wantsVideo) && audioOk && videoOk) {
                    runOnUiThread(() -> request.grant(resources));
                    return;
                }

                // Fall back to Capacitor's normal permission flow.
                super.onPermissionRequest(request);
            }
        });
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureMicPermission() {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.RECORD_AUDIO },
                MIC_REQ
            );
        }
    }
}
