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

/// Listen-only session event tap: a second fn source, plus "another key went down while fn
/// was held" so fn used as a modifier (fn+arrow, fn+F-key) cancels push-to-talk.
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
            if debugLogging { emit(["event": "debug", "keyCode": keyCode, "flags": event.flags.rawValue]) }
            guard keyCode == fnKeyCode else { return }
            state.set(down: event.flags.contains(.maskSecondaryFn), source: "tap")
        case .keyDown:
            if state.down { emit(["event": "chord", "t": nowMs()]) }
        default:
            break
        }
    }
}
