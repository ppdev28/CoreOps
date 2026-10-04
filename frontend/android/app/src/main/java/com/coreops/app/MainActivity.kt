package com.coreops.app

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.EdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.content.res.ResourcesCompat
import androidx.core.view.GravityCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.drawerlayout.widget.DrawerLayout
import com.google.android.material.appbar.MaterialToolbar
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    companion object {
        private const val DRAWER_WIDTH_DP = 300
        private const val BG = 0xFF0B0D10.toInt()
        private const val SURFACE = 0xFF11151B.toInt()
        private const val ACTIVE = 0xFF18283A.toInt()
        private const val BORDER = 0xFF252B34.toInt()
        private const val TEXT = 0xFFF3F4F6.toInt()
        private const val TEXT_SUB = 0xFFDCE0E8.toInt()
        private const val TEXT_DIM = 0xFF7E8796.toInt()
        private const val ACCENT = 0xFF3B82F6.toInt()
        private const val GREEN = 0xFF22C55E.toInt()
    }

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var toolbar: MaterialToolbar
    private lateinit var drawer: LinearLayout

    private data class NativeDestination(
        val view: String,
        val title: String,
        val iconRes: Int
    )

    private data class NavigationSection(
        val title: String?,
        val items: List<NativeDestination>
    )

    private val destinations = LinkedHashMap<String, NativeDestination>()
    private var activeView = "dashboard"

    private val navigationSections = listOf(
        NavigationSection(
            null,
            listOf(
                NativeDestination("dashboard", "Dashboard", R.drawable.ic_dashboard)
            )
        ),
        NavigationSection(
            "Infrastructure",
            listOf(
                NativeDestination("host", "Host", R.drawable.ic_host),
                NativeDestination("containers", "Containers", R.drawable.ic_containers),
                NativeDestination("applications", "Applications", R.drawable.ic_applications),
                NativeDestination("services", "Services", R.drawable.ic_services),
                NativeDestination("storage", "Storage", R.drawable.ic_storage),
                NativeDestination("network", "Network", R.drawable.ic_network),
                NativeDestination("virtual-machines", "Virtual machines", R.drawable.ic_virtual_machines)
            )
        ),
        NavigationSection(
            "Observability",
            listOf(
                NativeDestination("monitoring", "Monitoring", R.drawable.ic_monitoring),
                NativeDestination("logs", "Logs", R.drawable.ic_logs)
            )
        ),
        NavigationSection(
            "Tools",
            listOf(
                NativeDestination("terminal", "Terminal", R.drawable.ic_terminal)
            )
        ),
        NavigationSection(
            "System",
            listOf(
                NativeDestination("security", "Security", R.drawable.ic_security),
                NativeDestination("updates", "Updates", R.drawable.ic_updates),
                NativeDestination("settings", "Settings", R.drawable.ic_settings)
            )
        )
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        EdgeToEdge.enable(this)
        setupNativeShell()
    }

    private fun setupNativeShell() {
        val webView = bridge.webView ?: return
        webView.post { installNativeShell(webView) }
    }

    private fun installNativeShell(webView: WebView) {
        val webViewParent = webView.parent as? ViewGroup ?: return
        webViewParent.removeView(webView)

        drawerLayout = DrawerLayout(this).apply {
            setBackgroundColor(BG)
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
        }

        toolbar = MaterialToolbar(this).apply {
            title = "CoreOps"
            setTitleTextColor(TEXT)
            setBackgroundColor(SURFACE)
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

        webView.setBackgroundColor(BG)
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

        drawer = buildDrawer()

        val drawerParams = DrawerLayout.LayoutParams(
            dp(DRAWER_WIDTH_DP),
            ViewGroup.LayoutParams.MATCH_PARENT
        ).apply {
            gravity = GravityCompat.START
        }
        drawerLayout.addView(drawer, drawerParams)

        setContentView(drawerLayout)
        applyInsets(toolbar, webView, drawer)

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

    private fun buildDrawer(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(SURFACE)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(SURFACE)
        }

        val logo = ImageView(this).apply {
            setImageResource(R.drawable.ic_coreops_logo)
            background = ResourcesCompat.getDrawable(resources, R.drawable.ic_coreops_background, theme)
            setPadding(dp(7), dp(7), dp(7), dp(7))
        }
        header.addView(
            logo,
            LinearLayout.LayoutParams(dp(30), dp(30))
        )

        val brand = TextView(this).apply {
            text = "CoreOps"
            setTextColor(TEXT)
            textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, 0, 0)
        }
        header.addView(
            brand,
            LinearLayout.LayoutParams(0, dp(30), 1f)
        )

        root.addView(
            header,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(58)
            )
        )

        root.addView(divider())

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        }

        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(6), 0, dp(8))
        }

        navigationSections.forEachIndexed { index, section ->
            section.title?.let { title ->
                if (index > 0) {
                    nav.addView(divider())
                }
                nav.addView(sectionLabel(title))
            }

            section.items.forEach { destination ->
                destinations[destination.view] = destination
                nav.addView(navigationItem(destination))
            }
        }

        scroll.addView(
            nav,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )
        root.addView(
            scroll,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        root.addView(divider())

        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
        }

        val statusDot = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(GREEN)
            }
        }
        footer.addView(
            statusDot,
            LinearLayout.LayoutParams(dp(7), dp(7))
        )

        val status = TextView(this).apply {
            text = "Server online"
            setTextColor(TEXT_DIM)
            textSize = 11f
            setPadding(dp(8), 0, 0, 0)
        }
        footer.addView(
            status,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(
            footer,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(44)
            )
        )

        return root
    }

    private fun navigationItem(destination: NativeDestination): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(42)
            setPadding(dp(16), 0, dp(12), 0)
            isClickable = true
            isFocusable = true
            setOnClickListener {
                selectDestination(destination)
            }
        }

        val accent = View(this)
        row.addView(
            accent,
            LinearLayout.LayoutParams(dp(2), dp(24))
        )

        val icon = ImageView(this).apply {
            setImageResource(destination.iconRes)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }
        val iconParams = LinearLayout.LayoutParams(dp(24), dp(24)).apply {
            leftMargin = dp(8)
            rightMargin = dp(10)
        }
        row.addView(icon, iconParams)

        val label = TextView(this).apply {
            text = destination.title
            textSize = 13f
            setTextColor(TEXT_SUB)
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(
            label,
            LinearLayout.LayoutParams(0, dp(42), 1f)
        )

        if (destination.view == "updates") {
            val badge = TextView(this).apply {
                text = "12"
                textSize = 10f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    cornerRadius = dp(4).toFloat()
                    setColor(0xFF245DAA.toInt())
                }
                setPadding(dp(5), 0, dp(5), 0)
            }
            row.addView(
                badge,
                LinearLayout.LayoutParams(dp(28), dp(20)).apply {
                    rightMargin = dp(2)
                }
            )
        }

        row.tag = NavigationRowRefs(accent, icon, label)
        applyNavigationState(row, destination.view == activeView)
        return row
    }

    private data class NavigationRowRefs(
        val accent: View,
        val icon: ImageView,
        val label: TextView
    )

    private fun selectDestination(destination: NativeDestination) {
        activeView = destination.view
        val nav = (drawer.getChildAt(1) as? ScrollView)?.getChildAt(0) as? LinearLayout
        nav?.let { container ->
            for (i in 0 until container.childCount) {
                val child = container.getChildAt(i)
                val refs = child.tag as? NavigationRowRefs ?: continue
                val selected = (child.findViewWithTag<Any>(null) == null) // no-op; state below is driven by destination lookup
                val destinationForRow = findDestinationForRow(child)
                applyNavigationState(child, destinationForRow?.view == activeView)
            }
        }

        toolbar.title = destination.title
        navigateReact(destination.view)
        drawerLayout.closeDrawer(GravityCompat.START)
    }

    private fun findDestinationForRow(row: View): NativeDestination? {
        val refs = row.tag as? NavigationRowRefs ?: return null
        val label = refs.label.text.toString()
        return destinations.values.firstOrNull { it.title == label }
    }

    private fun applyNavigationState(row: View, selected: Boolean) {
        val refs = row.tag as? NavigationRowRefs ?: return
        row.setBackgroundColor(if (selected) ACTIVE else Color.TRANSPARENT)
        refs.accent.setBackgroundColor(if (selected) ACCENT else Color.TRANSPARENT)
        refs.icon.setColorFilter(if (selected) ACCENT else TEXT_DIM, PorterDuff.Mode.SRC_IN)
        refs.label.setTextColor(if (selected) TEXT else TEXT_SUB)
    }

    private fun sectionLabel(title: String): TextView =
        TextView(this).apply {
            text = title.uppercase()
            setTextColor(TEXT_DIM)
            textSize = 10f
            setTypeface(null, android.graphics.Typeface.BOLD)
            letterSpacing = 0.09f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(4))
            includeFontPadding = false
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(28)
            )
        }

    private fun divider(): View =
        View(this).apply {
            setBackgroundColor(BORDER)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(1)
            )
        }

    private fun navigateReact(view: String) {
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

        ViewCompat.setOnApplyWindowInsetsListener(drawer) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or
                    WindowInsetsCompat.Type.navigationBars()
            )
            view.setPadding(view.paddingLeft, bars.top, view.paddingRight, bars.bottom)
            insets
        }

        ViewCompat.requestApplyInsets(toolbar)
        ViewCompat.requestApplyInsets(webView)
        ViewCompat.requestApplyInsets(drawer)
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt().let { kotlin.math.round(it.toDouble()).toInt() }
}
