package com.lammah.search;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Ensures OS mic permission is granted and WebView getUserMedia is bridged correctly.
 * MicStreamPlugin provides a native AudioRecord fallback when WebView still fails.
 */
public class MainActivity extends BridgeActivity {
    private static final int MIC_REQ = 9911;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MicStreamPlugin.class);
        super.onCreate(savedInstanceState);
        ensureMicPermission();
    }

    @Override
    protected void load() {
        super.load();
        installWebChromeClient();
    }

    @Override
    public void onResume() {
        super.onResume();
        installWebChromeClient();
    }

    private void installWebChromeClient() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        WebView webView = getBridge().getWebView();
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        if (!(webView.getWebChromeClient() instanceof LammahWebChromeClient)) {
            webView.setWebChromeClient(new LammahWebChromeClient(getBridge()));
        }
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureMicPermission() {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.RECORD_AUDIO }, MIC_REQ);
        }
    }
}
