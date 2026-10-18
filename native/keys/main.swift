// diktatorn-keys: reports fn (Globe) key presses to the Electron main process.
//
// Protocol: one JSON object per line on stdout. Commands arrive on stdin; EOF means the
// parent is gone and the helper exits.
//   out  {"event":"ready","inputMonitoring":true}
//   out  {"event":"fn","down":true,"t":123456.7}       t = monotonic milliseconds
//   out  {"event":"chord","t":...}                      another key went down while fn was held
//   out  {"event":"tap","enabled":true,"reason":"..."}  the system disabled the tap; we re-enabled it
//   out  {"event":"error","message":"..."}
//   in   {"cmd":"shutdown"}
//
// Privacy: no key codes or characters ever leave this process.

import ApplicationServices
import Foundation

let fnKeyCode: Int64 = 63  // kVK_Function

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func nowMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

final class FnTap {
    private var tap: CFMachPort?
    private var fnDown = false

    func start() -> Bool {
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, refcon in
                let me = Unmanaged<FnTap>.fromOpaque(refcon!).takeUnretainedValue()
                me.handle(type: type, event: event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: refcon
        ) else { return false }
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    private func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            emit(["event": "tap", "enabled": true, "reason": type == .tapDisabledByTimeout ? "timeout" : "userInput"])
        case .flagsChanged:
            guard event.getIntegerValueField(.keyboardEventKeycode) == fnKeyCode else { return }
            let down = event.flags.contains(.maskSecondaryFn)
            guard down != fnDown else { return }
            fnDown = down
            emit(["event": "fn", "down": down, "t": nowMs()])
        case .keyDown:
            if fnDown { emit(["event": "chord", "t": nowMs()]) }
        default:
            break
        }
    }
}

func readCommands() {
    Thread.detachNewThread {
        while let line = readLine() {
            guard let data = line.data(using: .utf8),
                  let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                emit(["event": "error", "message": "unparseable command"])
                continue
            }
            if msg["cmd"] as? String == "shutdown" { exit(0) }
        }
        exit(0)  // stdin closed: parent exited
    }
}

setvbuf(stdout, nil, _IOLBF, 0)
readCommands()

let granted = CGPreflightListenEventAccess()
if !granted { _ = CGRequestListenEventAccess() }

let fnTap = FnTap()
guard fnTap.start() else {
    emit(["event": "ready", "inputMonitoring": false])
    emit(["event": "error", "message": "could not create event tap; grant Input Monitoring and restart"])
    // Stay alive so the parent can show the permission state; exit on stdin EOF.
    CFRunLoopRun()
    exit(1)
}
emit(["event": "ready", "inputMonitoring": true])
CFRunLoopRun()
