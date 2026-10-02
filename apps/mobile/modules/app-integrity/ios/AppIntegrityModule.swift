import CryptoKit
import DeviceCheck
import ExpoModulesCore

// Spec §6: App Attest on iPhones that have it, DeviceCheck on the few that don't. The private key is made in, and never
// leaves, the Secure Enclave; JavaScript sees only the key's id and the proofs. Each challenge or request text is
// hashed here with SHA-256 into the client data hash Apple signs, exactly as the server recomputes it.
public class AppIntegrityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppIntegrity")

    Constant("isAppAttestSupported") { DCAppAttestService.shared.isSupported }
    Constant("isDeviceCheckSupported") { DCDevice.current.isSupported }

    AsyncFunction("generateKey") { () async throws -> String in
      try await apple { try await DCAppAttestService.shared.generateKey() }
    }

    AsyncFunction("attestKey") { (keyId: String, challenge: String) async throws -> String in
      try await apple {
        try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: hashed(challenge)).base64EncodedString()
      }
    }

    AsyncFunction("generateAssertion") { (keyId: String, clientData: String) async throws -> String in
      try await apple {
        try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: hashed(clientData))
          .base64EncodedString()
      }
    }

    AsyncFunction("deviceCheckToken") { () async throws -> String in
      try await apple { try await DCDevice.current.generateToken().base64EncodedString() }
    }
  }
}

private func hashed(_ text: String) -> Data {
  Data(SHA256.hash(data: Data(text.utf8)))
}

// A key the system no longer holds (after a reinstall, a restore or a migration) must be replaced, so it gets its own
// code; any other failure is just a failure, and the write goes without a proof.
private func apple<T>(_ work: () async throws -> T) async throws -> T {
  do {
    return try await work()
  } catch let error as DCError where error.code == .invalidKey {
    throw AppIntegrityException("ERR_INVALID_KEY")
  } catch {
    throw AppIntegrityException("ERR_APP_INTEGRITY")
  }
}

// Swift 6 wants a subclass to restate Exception's Sendable conformance; it holds only immutable strings.
internal final class AppIntegrityException: Exception, @unchecked Sendable {
  init(_ code: String) {
    super.init(name: "AppIntegrityException", description: "[AppIntegrity] \(code)", code: code)
  }
}
