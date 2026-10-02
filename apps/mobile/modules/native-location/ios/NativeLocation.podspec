Pod::Spec.new do |s|
  s.name           = 'NativeLocation'
  s.version        = '1.0.0'
  s.summary        = 'The platform geocoder for place search, and temporary full accuracy'
  s.description    = 'Turns place text into a point with CLGeocoder, and asks for temporary full accuracy, on the phone.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
