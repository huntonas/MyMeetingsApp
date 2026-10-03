Pod::Spec.new do |s|
  s.name           = 'AppIntegrity'
  s.version        = '1.0.0'
  s.summary        = 'App Attest and DeviceCheck for app checks'
  s.description    = 'Makes and attests an App Attest key, signs requests with it, and makes DeviceCheck tokens.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'DeviceCheck', 'CryptoKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
