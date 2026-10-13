package com.hutkakart.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // a file shared to Hutka ("Share → Hutka" from the Alfano app or a file manager) arrives as ACTION_SEND; the Capacitor bridge only
    // forwards ACTION_VIEW to the web layer (appUrlOpen), so the shared file is re-wrapped as a VIEW intent before the bridge sees it
    @Override
    public void onCreate(Bundle savedInstanceState) {
        Intent v = asView(getIntent());
        if (v != null) setIntent(v);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent v = asView(intent);
        super.onNewIntent(v != null ? v : intent);
    }

    private Intent asView(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return null;
        Intent v = new Intent(Intent.ACTION_VIEW, uri);
        v.setClass(this, MainActivity.class);
        v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return v;
    }
}
