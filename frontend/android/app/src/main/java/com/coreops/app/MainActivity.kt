package com.coreops.app

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.EdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.annotation.NonNull
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.Insets
import androidx.core.view.GravityCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.drawerlayout.widget.DrawerLayout
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.navigation.NavigationView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    companion object {
        private const val DRAWER_WIDTH_DP = 300
    }

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var toolbar: MaterialToolbar
    private lateinit var navigationView: NavigationView

    private data class NativeDestination(
        val view: String,
        val title: String,
        val iconRes: Int
    )

    private val destinations = LinkedHashMap<Int, NativeDestination>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        EdgeToEdge.enable(this)
        setupNativeShell()
    }

    private fun setupNativeShell() {
        val webView = bridge.webView ?: return

        // BridgeActivity creates and attaches the WebView during super.onCreate().
        // Post the re-parenting so the Capacitor view hierarchy is guaranteed to exist.
        webView.post { installNativeShell(webView) }
    }

    private fun installNativeShell(webView: WebView) {
        val webViewParent = webView.parent as? ViewGroup ?: return
        webViewParent.removeView(webView)

        drawerLayout = DrawerLayout(this).apply {
            setBackgroundColor(Color.rgb(11, 13, 16))
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(11, 13, 16))
        }

        toolbar = MaterialToolbar(this).apply {
            title = "CoreOps"
            setTitleTextColor(Color.rgb(243, 244, 246))
            setBackgroundColor(Color.rgb(17, 21, 27))
            navigationIcon = ResourcesCompat.getDrawable(resources, R.drawable.ic_menu, theme)
            setNavigationOnClickListener {
                drawerLayout.openDrawer(GravityCompat.START)
            }
        }

        content.addView(
            toolbar,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56)
            )
        )

        webView.setBackgroundColor(Color.rgb(11, 13, 16))

        // The Capacitor page itself is served from HTTPS. Allow the native shell
        // to reach the CoreOps backend over the private Tailscale HTTP endpoint.
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        content.addView(
            webView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        drawerLayout.addView(
            content,
            DrawerLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        navigationView = NavigationView(this).apply {
            setBackgroundColor(Color.rgb(17, 21, 27))
            setItemTextColor(android.content.res.ColorStateList.valueOf(Color.rgb(220, 224, 232)))
            itemIconTintList = null
        }

        val header = TextView(this).apply {
            text = "CoreOps"
            setTextColor(Color.rgb(243, 244, 246))
            textSize = 20f
            gravity = Gravity.CENTER_VERTICAL
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(dp(24), dp(8), dp(16), dp(8))
            setBackgroundColor(Color.rgb(17, 21, 27))
        }
        navigationView.addHeaderView(header)

        populateNavigation()

        DrawerLayout.LayoutParams(
            dp(DRAWER_WIDTH_DP),
            ViewGroup.LayoutParams.MATCH_PARENT
        ).also { drawerParams ->
            drawerParams.gravity = GravityCompat.START
            drawerLayout.addView(navigationView, drawerParams)
        }

        setContentView(drawerLayout)

        applyInsets(toolbar, webView, navigationView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    drawerLayout.isDrawerOpen(GravityCompat.START) ->
                        drawerLayout.closeDrawer(GravityCompat.START)

                    webView.canGoBack() ->
                        webView.goBack()

                    else ->
                        finish()
                }
            }
        })
    }

    private fun populateNavigation() {
        destinations.clear()

        addDestination("Dashboard", "dashboard", android.R.drawable.ic_menu_view)
        addDestination("Host", "host", android.R.drawable.ic_menu_info_details)
        addDestination("Containers", "containers", android.R.drawable.ic_menu_manage)
        addDestination("Applications", "applications", android.R.drawable.ic_menu_agenda)
        addDestination("Services", "services", android.R.drawable.ic_menu_rotate)
        addDestination("Storage", "storage", android.R.drawable.ic_menu_save)
        addDestination("Network", "network", android.R.drawable.ic_menu_share)
        addDestination("Virtual machines", "virtual-machines", android.R.drawable.ic_menu_slideshow)
        addDestination("Monitoring", "monitoring", android.R.drawable.ic_menu_recent_history)
        addDestination("Logs", "logs", android.R.drawable.ic_menu_edit)
        addDestination("Terminal", "terminal", android.R.drawable.ic_menu_set_as)
        addDestination("Security", "security", android.R.drawable.ic_lock_lock)
        addDestination("Updates", "updates", android.R.drawable.ic_popup_sync)
        addDestination("Settings", "settings", android.R.drawable.ic_menu_preferences)

        navigationView.setNavigationItemSelectedListener { item ->
            destinations[item.itemId]?.let { destination ->
                toolbar.title = destination.title
                navigateReact(destination.view)
            }
            navigationView.setCheckedItem(item.itemId)
            drawerLayout.closeDrawer(GravityCompat.START)
            true
        }

        navigationView.setCheckedItem(findDestinationId("dashboard"))
    }

    private fun addDestination(title: String, view: String, iconRes: Int) {
        val id = View.generateViewId()
        destinations[id] = NativeDestination(view, title, iconRes)
        navigationView.menu
            .add(android.view.Menu.NONE, id, android.view.Menu.NONE, title)
            .setIcon(iconRes)
    }

    private fun findDestinationId(view: String): Int =
        destinations.entries.firstOrNull { it.value.view == view }?.key ?: 0

    private fun navigateReact(@NonNull view: String) {
        val webView = bridge.webView ?: return
        val escaped = view.replace("\\", "\\\\").replace("'", "\\'")
        val js = "window.dispatchEvent(new CustomEvent('coreops-native-navigate',{detail:{view:'$escaped'}}));"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun applyInsets(toolbar: View, webView: View, drawer: View) {
        ViewCompat.setOnApplyWindowInsetsListener(toolbar) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            view.setPadding(view.paddingLeft, bars.top, view.paddingRight, 0)
            insets
        }

        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.navigationBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(bars.left, 0, bars.right, bars.bottom)
            insets
        }

        ViewCompat.requestApplyInsets(toolbar)
        ViewCompat.requestApplyInsets(webView)
        ViewCompat.requestApplyInsets(drawer)
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt().let { kotlin.math.round(it.toDouble()).toInt() }
}
