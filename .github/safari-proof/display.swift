import CoreGraphics
import Foundation

let display = CGMainDisplayID()
let options = [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary
let modes = CGDisplayCopyAllDisplayModes(display, options) as? [CGDisplayMode] ?? []
let retina = modes.filter { $0.width >= 1366 && $0.height >= 840 && $0.pixelWidth >= $0.width * 2 }
let preferred = retina.min {
    abs($0.width - 1440) + abs($0.height - 950) < abs($1.width - 1440) + abs($1.height - 950)
}
if let mode = preferred {
    print("Retina mode request: \(mode.width)x\(mode.height); result \(CGDisplaySetDisplayMode(display, mode, nil).rawValue)")
} else {
    print("No matching Retina display mode exposed; the browser will report the actual viewport and scale.")
}
if let mode = CGDisplayCopyDisplayMode(display) {
    print("Current display: \(mode.width)x\(mode.height) CSS; \(mode.pixelWidth)x\(mode.pixelHeight) backing pixels")
}
