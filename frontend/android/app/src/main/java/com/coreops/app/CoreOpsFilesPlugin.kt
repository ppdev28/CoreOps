package com.coreops.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Streams to Android's document picker, including cloud providers, without
 * storage permissions, base64 bridge payloads or in-memory file buffers. */
@CapacitorPlugin(name = "CoreOpsFiles")
class CoreOpsFilesPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var connection: HttpURLConnection? = null

    @PluginMethod
    fun saveDownload(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val uri = Uri.parse(url)
        if (uri.scheme !in listOf("http", "https") || uri.host.isNullOrEmpty() ||
            uri.path?.endsWith("/files/download") != true ||
            uri.getQueryParameter("ticket")?.matches(Regex("[a-f0-9]{64}")) != true) {
            call.reject("Invalid CoreOps download URL")
            return
        }
        val name = (call.getString("name") ?: "download").replace('/', '_').replace('\\', '_').replace('\r', '_').replace('\n', '_')
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_TITLE, name)
        }
        try {
            startActivityForResult(call, intent, "destinationSelected")
        } catch (error: Exception) {
            call.reject("Unable to open the system file picker", error)
        }
    }

    @ActivityCallback
    private fun destinationSelected(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val destination = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || destination == null) {
            call.reject("Download cancelled")
            return
        }
        worker.execute {
            try {
                val http = URL(call.getString("url")).openConnection() as HttpURLConnection
                connection = http
                http.connectTimeout = 15000
                http.readTimeout = 60000
                http.instanceFollowRedirects = false
                if (http.responseCode != HttpURLConnection.HTTP_OK) {
                    throw java.io.IOException("Download link expired or the server refused the download. Try again.")
                }
                val expected = http.getHeaderField("Content-Length")?.toLongOrNull()
                val copied = http.inputStream.use { input ->
                    val output = context.contentResolver.openOutputStream(destination, "w")
                        ?: throw java.io.IOException("Unable to write to the selected location")
                    output.use { input.copyTo(it, 64 * 1024) }
                }
                if (expected != null && copied != expected) {
                    throw java.io.IOException("The download was interrupted. Try again.")
                }
                call.resolve()
            } catch (error: Exception) {
                try { DocumentsContract.deleteDocument(context.contentResolver, destination) } catch (_: Exception) { }
                call.reject(error.message ?: "Unable to save the file", error)
            } finally {
                connection?.disconnect()
                connection = null
            }
        }
    }

    override fun handleOnDestroy() {
        connection?.disconnect()
        worker.shutdownNow()
        super.handleOnDestroy()
    }
}
