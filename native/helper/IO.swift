// Line-delimited JSON output shared by the helper's components.
import Foundation

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

/// Monotonic milliseconds, comparable across events from this process.
func nowMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

let debugLogging = ProcessInfo.processInfo.environment["DIKTATORN_HELPER_DEBUG"] != nil
