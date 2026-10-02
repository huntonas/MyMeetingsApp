import CoreLocation
import ExpoModulesCore

// Spec §8: the phone sends the text someone types to Apple's geocoder, with no location permission, and gets a point
// back. Our server never sees the text. (CLGeocoder is deprecated from iOS 26 in favour of MapKit's geocoding request; it
// still works on every iOS Expo SDK 57 supports.)
public class NativeLocationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeLocation")

    AsyncFunction("findPlace") { (text: String) async -> [String: Double]? in
      // CLGeocoder reports "no match" as an error; either way the answer is "not found".
      guard let placemarks = try? await CLGeocoder().geocodeAddressString(text),
            let coordinate = placemarks.first?.location?.coordinate else { return nil }
      return ["latitude": coordinate.latitude, "longitude": coordinate.longitude]
    }

    // Spec §8: an iPhone sharing only approximate location asks, for the attendance check alone, for full accuracy
    // until the app leaves the foreground. The purpose key names the string in app.config.ts's
    // NSLocationTemporaryUsageDescriptionDictionary. Answers whether full accuracy is on afterwards. The manager is
    // created on the main queue, which CLLocationManager needs, and kept until iOS answers.
    AsyncFunction("requestTemporaryFullAccuracy") { (purposeKey: String, promise: Promise) in
      let manager = CLLocationManager()
      if manager.accuracyAuthorization == .fullAccuracy {
        promise.resolve(true)
        return
      }
      manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: purposeKey) { _ in
        promise.resolve(manager.accuracyAuthorization == .fullAccuracy)
      }
    }.runOnQueue(.main)
  }
}
