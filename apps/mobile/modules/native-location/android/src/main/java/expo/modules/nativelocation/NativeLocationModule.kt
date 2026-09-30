package expo.modules.nativelocation

import android.location.Address
import android.location.Geocoder
import android.os.Build
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

// Spec §8: Android's own Geocoder needs no location permission (expo-location's wrapper insists on one), so a fresh
// install with no permission can still search by place. The phone sends the text to Google's geocoder (or the phone
// maker's location service); our server never sees it.
class NativeLocationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeLocation")

    AsyncFunction("findPlace") Coroutine { text: String ->
      val context = appContext.reactContext ?: return@Coroutine null
      if (!Geocoder.isPresent()) return@Coroutine null
      val address = firstAddress(Geocoder(context, Locale.US), text) ?: return@Coroutine null
      mapOf("latitude" to address.latitude, "longitude" to address.longitude)
    }
  }

  private suspend fun firstAddress(geocoder: Geocoder, text: String): Address? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      suspendCancellableCoroutine { continuation ->
        geocoder.getFromLocationName(text, 1, object : Geocoder.GeocodeListener {
          override fun onGeocode(addresses: MutableList<Address>) {
            continuation.resume(addresses.firstOrNull())
          }

          override fun onError(errorMessage: String?) {
            continuation.resume(null)
          }
        })
      }
    } else {
      withContext(Dispatchers.IO) {
        @Suppress("DEPRECATION")
        runCatching { geocoder.getFromLocationName(text, 1) }.getOrNull()?.firstOrNull()
      }
    }
}
