package app.parimere.mobile;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ParimerePrint")
public class ParimerePrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("Printing is unavailable on this device.");
                    return;
                }
                manager.print("Parimere comparison", getBridge().getWebView()
                    .createPrintDocumentAdapter("Parimere comparison"), new PrintAttributes.Builder().build());
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Could not open the Android print dialog.", error);
            }
        });
    }
}
