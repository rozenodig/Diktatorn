// Inserts text into the focused field of the frontmost app: snapshot the clipboard, put the
// text on it, press Cmd+V, then put the user's clipboard back.
import AppKit
import ApplicationServices

/// Conventions from nspasteboard.org that clipboard managers and password managers follow.
let concealedType = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

/// Every item on the pasteboard with every type its source provided, as raw data.
typealias PasteboardSnapshot = [[(NSPasteboard.PasteboardType, Data)]]

func snapshotPasteboard(_ pb: NSPasteboard) -> PasteboardSnapshot? {
    let items = pb.pasteboardItems ?? []
    // Password-manager content is never kept alive by putting it back.
    if items.contains(where: { $0.types.contains(concealedType) }) { return nil }
    return items.map { item in item.types.compactMap { type in item.data(forType: type).map { (type, $0) } } }
}

func restorePasteboard(_ pb: NSPasteboard, _ snapshot: PasteboardSnapshot) {
    pb.clearContents()
    let items = snapshot.map { entries in
        let item = NSPasteboardItem()
        for (type, data) in entries { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { pb.writeObjects(items) }
}

/// Puts plain text on the pasteboard, marked transient so clipboard managers skip it.
/// Returns the pasteboard's change count right after our write.
func writeText(_ pb: NSPasteboard, _ text: String) -> Int {
    pb.clearContents()
    let item = NSPasteboardItem()
    item.setString(text, forType: .string)
    item.setData(Data(), forType: transientType)
    pb.writeObjects([item])
    return pb.changeCount
}

func frontmostApp() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return ["bundleId": NSNull(), "name": NSNull()] }
    return ["bundleId": app.bundleIdentifier ?? NSNull(), "name": app.localizedName ?? NSNull(), "pid": app.processIdentifier]
}

final class Inserter {
    private var promptedForAccessibility = false
    private let heldModifiers: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift, .maskSecondaryFn]

    var accessibilityTrusted: Bool { AXIsProcessTrusted() }

    /// - dryRun: skip the keystroke (tests; needs no Accessibility).
    /// - pasteboardName: tests use a private pasteboard instead of the user's clipboard.
    func insert(text: String, restoreDelayMs: Int, dryRun: Bool, pasteboardName: String?,
                completion: @escaping ([String: Any]) -> Void) {
        let pb = pasteboardName.map { NSPasteboard(name: NSPasteboard.Name($0)) } ?? .general
        if !dryRun && !accessibilityTrusted {
            // Without permission to send keystrokes, leave the text on the clipboard for a manual paste.
            _ = writeText(pb, text)
            if !promptedForAccessibility {
                promptedForAccessibility = true
                _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
            }
            completion(["pasted": false, "restored": false, "note": "accessibility not granted; text left on the clipboard"])
            return
        }
        waitForModifierRelease(until: nowMs() + 600) {
            let snapshot = snapshotPasteboard(pb)
            let ourChange = writeText(pb, text)
            if !dryRun { self.pressCommandV() }
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(restoreDelayMs)) {
                if snapshot == nil {
                    completion(["pasted": !dryRun, "restored": false, "note": "previous clipboard was concealed; not restored"])
                } else if pb.changeCount != ourChange {
                    completion(["pasted": !dryRun, "restored": false, "note": "clipboard changed meanwhile; not restored"])
                } else {
                    restorePasteboard(pb, snapshot!)
                    completion(["pasted": !dryRun, "restored": true, "note": ""])
                }
            }
        }
    }

    /// A still-held hotkey modifier would turn Cmd+V into another shortcut, so wait it out.
    private func waitForModifierRelease(until deadline: Double, then body: @escaping () -> Void) {
        let flags = CGEventSource.flagsState(.combinedSessionState)
        if flags.intersection(heldModifiers).isEmpty || nowMs() >= deadline {
            body()
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(10)) {
            self.waitForModifierRelease(until: deadline, then: body)
        }
    }

    private func pressCommandV() {
        let source = CGEventSource(stateID: .combinedSessionState)
        let vKey: CGKeyCode = 9  // kVK_ANSI_V: the V position on QWERTY-family layouts, including Swedish
        for keyDown in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: keyDown)
            event?.flags = .maskCommand
            event?.post(tap: .cghidEventTap)
        }
    }
}
