// fn (Globe) key detection from two sources: keyboard HID reports and a listen-only event tap.
import ApplicationServices
import Foundation
import IOKit.hid

let fnKeyCode: Int64 = 63  // kVK_Function

/// Single source of truth for the fn state. Both sources report into it, so a press seen by
/// both is emitted once.
final class FnState {
    private(set) var down = false

    func set(down: Bool, source: String) {
        if debugLogging { emit(["event": "debug", "fn": down, "source": source]) }
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

let escapeKeyCode: Int64 = 53  // kVK_Escape

/// Session event tap: a second fn source; "another key went down while fn was held", so fn
/// used as a modifier (fn+arrow, fn+F-key) cancels push-to-talk; and Esc to cancel a recording.
///
/// With Accessibility the tap is active and swallows Esc while a recording is in progress, so
/// the focused app never sees it. Every other event passes through untouched, and the callback
/// does no work beyond a few comparisons, because an active tap sits in the path of every
/// keystroke and the system disables taps that respond slowly.
final class FnTap {
    private var tap: CFMachPort?
    private let state: FnState
    private var swallowingEscape = false
    private(set) var active = false
    /// Set by the app while it is recording.
    var recording = false

    init(state: FnState) { self.state = state }

    func start() -> Bool {
        let types: [CGEventType] = [.flagsChanged, .keyDown, .keyUp]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<FnTap>.fromOpaque(refcon!).takeUnretainedValue()
            return me.handle(type: type, event: event) ? nil : Unmanaged.passUnretained(event)
        }
        // An active tap needs Accessibility; without it, fall back to listening only.
        for options: CGEventTapOptions in [.defaultTap, .listenOnly] {
            guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: options,
                                              eventsOfInterest: mask, callback: callback, userInfo: refcon) else { continue }
            self.tap = tap
            active = options == .defaultTap
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            return true
        }
        return false
    }

    /// Returns true to swallow the event.
    private func handle(type: CGEventType, event: CGEvent) -> Bool {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            emit(["event": "tap", "enabled": true, "reason": type == .tapDisabledByTimeout ? "timeout" : "userInput"])
        case .flagsChanged:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            if debugLogging { emit(["event": "debug", "keyCode": keyCode, "flags": event.flags.rawValue]) }
            if keyCode == fnKeyCode { state.set(down: event.flags.contains(.maskSecondaryFn), source: "tap") }
        case .keyDown:
            if event.getIntegerValueField(.keyboardEventKeycode) == escapeKeyCode && (recording || swallowingEscape) {
                if !swallowingEscape { emit(["event": "escape", "t": nowMs()]) }  // once, not per auto-repeat
                swallowingEscape = active
                return active
            }
            if state.down { emit(["event": "chord", "t": nowMs()]) }
        case .keyUp:
            if event.getIntegerValueField(.keyboardEventKeycode) == escapeKeyCode && swallowingEscape {
                swallowingEscape = false
                return true
            }
        default:
            break
        }
        return false
    }
}
