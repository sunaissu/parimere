package app.parimere.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ParimerePrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
