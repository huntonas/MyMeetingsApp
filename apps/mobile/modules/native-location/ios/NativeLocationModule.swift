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
  }
}
