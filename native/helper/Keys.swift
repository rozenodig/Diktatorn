// Hotkey detection: fn (Globe) from keyboard HID reports and the session event tap, or a
// right-hand modifier key from the event tap. Also reports Esc while recording.
import ApplicationServices
import Foundation
import IOKit.hid

let escapeKeyCode: Int64 = 53  // kVK_Escape

/// The keys that can be the dictation hotkey. None of them types anything by itself, so
/// holding one to talk has no side effect in the focused app.
enum Hotkey: String {
    case fn, rightOption, rightCommand, rightControl

    var keyCode: Int64 {
        switch self {
        case .fn: return 63  // kVK_Function
        case .rightOption: return 61  // kVK_RightOption
        case .rightCommand: return 54  // kVK_RightCommand
        case .rightControl: return 62  // kVK_RightControl
        }
    }

    /// The flag bit set while the key is held. The right-hand modifiers use their
    /// device-dependent bits, which tell the right key from the left one.
    var flag: UInt64 {
        switch self {
        case .fn: return CGEventFlags.maskSecondaryFn.rawValue
        case .rightOption: return 0x40  // NX_DEVICERALTKEYMASK
        case .rightCommand: return 0x10  // NX_DEVICERCMDKEYMASK
        case .rightControl: return 0x2000  // NX_DEVICERCTLKEYMASK
        }
    }
}

/// Single source of truth for whether the hotkey is held. Both fn sources report into it, so
/// a press seen by both is emitted once.
final class HotkeyState {
    private(set) var key: Hotkey = .fn
    private(set) var down = false

    func select(_ key: Hotkey) {
        if down { set(down: false, source: "switch") }
        self.key = key
    }

    func set(down: Bool, source: String) {
        if debugLogging { emit(["event": "debug", "hotkey": key.rawValue, "down": down, "source": source]) }
        guard down != self.down else { return }
        self.down = down
        emit(["event": "hotkey", "down": down, "t": nowMs()])
    }
}

/// Reads fn straight from keyboard HID reports. Apple keyboards handle fn/Globe below the
/// event-tap layer, so the tap alone does not reliably see it. The value filter limits the
/// reports we receive to the fn usage only. Ignored unless fn is the hotkey.
final class FnHID {
    private let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    private let state: HotkeyState

    init(state: HotkeyState) { self.state = state }

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
            guard me.state.key == .fn else { return }
            me.state.set(down: IOHIDValueGetIntegerValue(value) != 0, source: "hid")
        }, context)
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        return IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess
    }
}

/// Session event tap: the hotkey (a second source for fn); "another key went down while the
/// hotkey was held", so the hotkey used as a modifier (fn+arrow, ⌘+C) cancels push-to-talk;
/// and Esc to cancel a recording.
///
/// With Accessibility the tap is active and swallows Esc while a recording is in progress, so
/// the focused app never sees it. Every other event passes through untouched, and the callback
/// does no work beyond a few comparisons, because an active tap sits in the path of every
/// keystroke and the system disables taps that respond slowly.
final class KeyTap {
    private var tap: CFMachPort?
    private let state: HotkeyState
    private var swallowingEscape = false
    private(set) var active = false
    /// Set by the app while it is recording.
    var recording = false

    init(state: HotkeyState) { self.state = state }

    func start() -> Bool {
        let types: [CGEventType] = [.flagsChanged, .keyDown, .keyUp]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<KeyTap>.fromOpaque(refcon!).takeUnretainedValue()
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
            if keyCode == state.key.keyCode { state.set(down: event.flags.rawValue & state.key.flag != 0, source: "tap") }
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
