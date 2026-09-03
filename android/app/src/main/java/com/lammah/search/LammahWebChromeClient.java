package com.lammah.search;

import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * WebView getUserMedia must be granted immediately when RECORD_AUDIO is already
 * allowed. Capacitor's default flow re-launches the permission dialog and often
 * races with SpeechRecognition, ending as "Permission denied" in JavaScript.
 */
public class LammahWebChromeClient extends BridgeWebChromeClient {

    private final Bridge bridge;

    public LammahWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

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
            bridge.getActivity().runOnUiThread(() -> request.grant(resources));
            return;
        }

        super.onPermissionRequest(request);
    }

    private boolean hasPermission(String permission) {
        return (
            ContextCompat.checkSelfPermission(bridge.getContext(), permission) ==
            PackageManager.PERMISSION_GRANTED
        );
    }
}
