// diktatorn-keys: reports fn (Globe) key presses to the Electron main process.
//
// Protocol: one JSON object per line on stdout. Commands arrive on stdin; EOF means the
// parent is gone and the helper exits.
//   out  {"event":"ready","inputMonitoring":true}
//   out  {"event":"permission","inputMonitoring":true} granted while running; exits with code 3 so the
//                                                      parent restarts it with a tap that receives events
//   out  {"event":"fn","down":true,"t":123456.7}       t = monotonic milliseconds
//   out  {"event":"chord","t":...}                      another key went down while fn was held
//   out  {"event":"tap","enabled":true,"reason":"..."}  the system disabled the tap; we re-enabled it
//   out  {"event":"error","message":"..."}
//   in   {"cmd":"shutdown"}
//
// Privacy: no key codes or characters ever leave this process. The opt-in debug mode
// (DIKTATORN_KEYS_DEBUG=1) reports modifier-key changes only, never character keys.
//
// Without Input Monitoring the system still lets us create a listen-only tap but silently
// withholds keyboard events from it, so permission is checked explicitly.

import ApplicationServices
import IOKit.hid
import Foundation

let fnKeyCode: Int64 = 63  // kVK_Function
let exitPermissionGranted: Int32 = 3
let debugModifiers = ProcessInfo.processInfo.environment["DIKTATORN_KEYS_DEBUG"] != nil

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func nowMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

/// Single source of truth for the fn state. Both the event tap and IOHID report into it,
/// so a press seen by both is emitted once.
final class FnState {
    private(set) var down = false

    func set(down: Bool, source: String) {
        if debugModifiers { emit(["event": "debug", "fn": down, "source": source]) }
        guard down != self.down else { return }
        self.down = down
        emit(["event": "fn", "down": down, "t": nowMs()])
    }
}

/// Reads fn straight from keyboard HID reports. Apple keyboards handle fn/Globe below the
/// event-tap layer, so the tap alone does not reliably see it. The value filter limits the
/// reports we receive to the fn usage only.
final class FnHID {
    private let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    private let state: FnState

    init(state: FnState) { self.state = state }

    func start() -> Bool {
        let keyboards = [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop, kIOHIDDeviceUsageKey: kHIDUsage_GD_Keyboard]
        IOHIDManagerSetDeviceMatching(manager, keyboards as CFDictionary)
        let fnUsages = [
            [kIOHIDElementUsagePageKey: 0x00FF, kIOHIDElementUsageKey: 0x03],  // built-in keyboards (top case)
            [kIOHIDElementUsagePageKey: 0xFF01, kIOHIDElementUsageKey: 0x03],  // external Apple keyboards
        ]
        IOHIDManagerSetInputValueMatchingMultiple(manager, fnUsages as CFArray)
        let context = Unmanaged.passUnretained(self).toOpaque()
        IOHIDManagerRegisterInputValueCallback(manager, { context, _, _, value in
            let me = Unmanaged<FnHID>.fromOpaque(context!).takeUnretainedValue()
            me.state.set(down: IOHIDValueGetIntegerValue(value) != 0, source: "hid")
        }, context)
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        return IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess
    }
}

final class FnTap {
    private var tap: CFMachPort?
    private let state: FnState

    init(state: FnState) { self.state = state }

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
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            if debugModifiers {
                emit(["event": "debug", "keyCode": keyCode, "flags": event.flags.rawValue])
            }
            guard keyCode == fnKeyCode else { return }
            state.set(down: event.flags.contains(.maskSecondaryFn), source: "tap")
        case .keyDown:
            if state.down { emit(["event": "chord", "t": nowMs()]) }
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

if !CGPreflightListenEventAccess() {
    _ = CGRequestListenEventAccess()  // shows the system prompt once; afterwards the app is listed, switched off
    emit(["event": "ready", "inputMonitoring": false])
    // A tap created now would never receive keys, so wait for the grant and let the parent restart us.
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        guard CGPreflightListenEventAccess() else { return }
        emit(["event": "permission", "inputMonitoring": true])
        exit(exitPermissionGranted)
    }
    CFRunLoopRun()
}

let fnState = FnState()
let fnTap = FnTap(state: fnState)
let fnHID = FnHID(state: fnState)
let tapOK = fnTap.start()
let hidOK = fnHID.start()
emit(["event": "ready", "inputMonitoring": true, "tap": tapOK, "hid": hidOK])
if !tapOK && !hidOK { emit(["event": "error", "message": "could not open the keyboard (event tap and HID both failed)"]) }
CFRunLoopRun()  // on total failure, stay alive so the parent shows the error; exit on stdin EOF
