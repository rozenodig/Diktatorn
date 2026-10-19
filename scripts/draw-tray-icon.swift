// Draws the menu bar icon, a plain microphone, as template PNGs at 1x and 2x. Template
// images are black with alpha; macOS tints them for light and dark menu bars.
// Usage: swift scripts/draw-tray-icon.swift assets
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets"

for scale in [1, 2] {
    let s = CGFloat(scale)
    let pixels = 18 * scale
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { fatalError("could not create bitmap") }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.black.setFill()
    NSColor.black.setStroke()

    // Coordinates in points on an 18 pt canvas, origin bottom-left.
    NSBezierPath(roundedRect: NSRect(x: 6 * s, y: 7 * s, width: 6 * s, height: 9 * s), xRadius: 3 * s, yRadius: 3 * s).fill()

    let outline = NSBezierPath()
    outline.appendArc(withCenter: NSPoint(x: 9 * s, y: 10.5 * s), radius: 5 * s, startAngle: 180, endAngle: 360, clockwise: false)
    outline.move(to: NSPoint(x: 9 * s, y: 5.5 * s))
    outline.line(to: NSPoint(x: 9 * s, y: 2.5 * s))
    outline.move(to: NSPoint(x: 6.5 * s, y: 2.5 * s))
    outline.line(to: NSPoint(x: 11.5 * s, y: 2.5 * s))
    outline.lineWidth = 1.5 * s
    outline.lineCapStyle = .round
    outline.stroke()

    NSGraphicsContext.restoreGraphicsState()
    let name = scale == 1 ? "trayTemplate.png" : "trayTemplate@2x.png"
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/\(name)"))
}
