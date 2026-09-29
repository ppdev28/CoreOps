package com.coreops.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.GravityCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.drawerlayout.widget.DrawerLayout;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.navigation.NavigationView;
import com.getcapacitor.BridgeActivity;

import java.util.LinkedHashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    private static final int DRAWER_WIDTH_DP = 300;

    private DrawerLayout drawerLayout;
    private MaterialToolbar toolbar;
    private NavigationView navigationView;

    private final Map<Integer, NativeDestination> destinations = new LinkedHashMap<>();

    private static final class NativeDestination {
        final String view;
        final String title;
        final int iconRes;

        NativeDestination(String view, String title, int iconRes) {
            this.view = view;
            this.title = title;
            this.iconRes = iconRes;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        EdgeToEdge.enable(this);
        setupNativeShell();
    }

    private void setupNativeShell() {
        final WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        // BridgeActivity creates and attaches the WebView during super.onCreate().
        // Post the re-parenting so the Capacitor view hierarchy is guaranteed to exist.
        webView.post(() -> installNativeShell(webView));
    }

    private void installNativeShell(final WebView webView) {
        final ViewGroup webViewParent = (ViewGroup) webView.getParent();
        if (webViewParent == null) {
            return;
        }

        webViewParent.removeView(webView);

        drawerLayout = new DrawerLayout(this);
        drawerLayout.setBackgroundColor(Color.rgb(11, 13, 16));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setBackgroundColor(Color.rgb(11, 13, 16));

        toolbar = new MaterialToolbar(this);
        toolbar.setTitle("CoreOps");
        toolbar.setTitleTextColor(Color.rgb(243, 244, 246));
        toolbar.setBackgroundColor(Color.rgb(17, 21, 27));
        toolbar.setNavigationIcon(R.drawable.ic_menu);
        toolbar.setNavigationOnClickListener(v ->
                drawerLayout.openDrawer(GravityCompat.START)
        );

        content.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56)
        ));

        webView.setBackgroundColor(Color.rgb(11, 13, 16));
        content.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        drawerLayout.addView(content, new DrawerLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        navigationView = new NavigationView(this);
        navigationView.setBackgroundColor(Color.rgb(17, 21, 27));
        navigationView.setItemTextColor(android.content.res.ColorStateList.valueOf(
                Color.rgb(220, 224, 232)
        ));
        navigationView.setItemIconTintList(null);

        TextView header = new TextView(this);
        header.setText("CoreOps");
        header.setTextColor(Color.rgb(243, 244, 246));
        header.setTextSize(20);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setTypeface(null, android.graphics.Typeface.BOLD);
        header.setPadding(dp(24), dp(8), dp(16), dp(8));
        header.setBackgroundColor(Color.rgb(17, 21, 27));
        navigationView.addHeaderView(header);

        populateNavigation();

        DrawerLayout.LayoutParams drawerParams = new DrawerLayout.LayoutParams(
                dp(DRAWER_WIDTH_DP),
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        drawerParams.gravity = GravityCompat.START;
        drawerLayout.addView(navigationView, drawerParams);

        setContentView(drawerLayout);

        applyInsets(toolbar, webView, navigationView);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
                    drawerLayout.closeDrawer(GravityCompat.START);
                    return;
                }

                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }

                finish();
            }
        });
    }

    private void populateNavigation() {
        destinations.clear();

        addDestination("Dashboard", "dashboard", android.R.drawable.ic_menu_view);
        addDestination("Host", "host", android.R.drawable.ic_menu_info_details);
        addDestination("Containers", "containers", android.R.drawable.ic_menu_manage);
        addDestination("Applications", "applications", android.R.drawable.ic_menu_agenda);
        addDestination("Services", "services", android.R.drawable.ic_menu_rotate);
        addDestination("Storage", "storage", android.R.drawable.ic_menu_save);
        addDestination("Network", "network", android.R.drawable.ic_menu_share);
        addDestination("Virtual machines", "virtual-machines", android.R.drawable.ic_menu_slideshow);
        addDestination("Monitoring", "monitoring", android.R.drawable.ic_menu_recent_history);
        addDestination("Logs", "logs", android.R.drawable.ic_menu_edit);
        addDestination("Terminal", "terminal", android.R.drawable.ic_menu_set_as);
        addDestination("Security", "security", android.R.drawable.ic_lock_lock);
        addDestination("Updates", "updates", android.R.drawable.ic_popup_sync);
        addDestination("Settings", "settings", android.R.drawable.ic_menu_preferences);

        navigationView.setNavigationItemSelectedListener(item -> {
            NativeDestination destination = destinations.get(item.getItemId());
            if (destination != null) {
                toolbar.setTitle(destination.title);
                navigateReact(destination.view);
            }
            navigationView.setCheckedItem(item.getItemId());
            drawerLayout.closeDrawer(GravityCompat.START);
            return true;
        });

        navigationView.setCheckedItem(findDestinationId("dashboard"));
    }

    private void addDestination(String title, String view, int iconRes) {
        int id = View.generateViewId();
        destinations.put(id, new NativeDestination(view, title, iconRes));
        navigationView.getMenu()
                .add(android.view.Menu.NONE, id, android.view.Menu.NONE, title)
                .setIcon(iconRes);
    }

    private int findDestinationId(String view) {
        for (Map.Entry<Integer, NativeDestination> entry : destinations.entrySet()) {
            if (entry.getValue().view.equals(view)) {
                return entry.getKey();
            }
        }
        return 0;
    }

    private void navigateReact(@NonNull String view) {
        WebView webView = getBridge().getWebView();
        String escaped = view.replace("\\", "\\\\").replace("'", "\\'");
        String js = "window.dispatchEvent(new CustomEvent('coreops-native-navigate',{detail:{view:'"
                + escaped
                + "'}}));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void applyInsets(View toolbar, View webView, View drawer) {
        ViewCompat.setOnApplyWindowInsetsListener(toolbar, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            view.setPadding(view.getPaddingLeft(), bars.top, view.getPaddingRight(), 0);
            return insets;
        });

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.navigationBars()
                            | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(bars.left, 0, bars.right, bars.bottom);
            return insets;
        });

        ViewCompat.requestApplyInsets(toolbar);
        ViewCompat.requestApplyInsets(webView);
        ViewCompat.requestApplyInsets(drawer);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
