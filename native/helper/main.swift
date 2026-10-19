// diktatorn-helper: the app's macOS integration. Reports the fn key and inserts text into
// the frontmost app.
//
// Protocol: one JSON object per line. Events and responses go to stdout; requests with an
// "id" arrive on stdin and are answered with the same id and "ok". EOF on stdin means the
// parent is gone and the helper exits.
//   out  {"event":"ready","inputMonitoring":true,"accessibility":true,"tap":true,"hid":true}
//   out  {"event":"permission","inputMonitoring":true} granted while running; exits with code 3 so the
//                                                      parent restarts it with a tap that receives events
//   out  {"event":"fn","down":true,"t":123456.7}       t = monotonic milliseconds
//   out  {"event":"chord","t":...}                      another key went down while fn was held
//   out  {"event":"escape","t":...}                     Esc pressed while recording (swallowed if the tap is active)
//   out  {"event":"tap","enabled":true,"reason":"..."}  the system disabled the tap; we re-enabled it
//   out  {"event":"error","message":"..."}
//   in   {"id":1,"cmd":"frontmost"}                     -> {"bundleId":"com.apple.Terminal","name":"Terminal","pid":1}
//   in   {"id":3,"cmd":"recording","active":true}       -> {} (Esc is reported/swallowed only while active)
//   in   {"id":2,"cmd":"insert","text":"…","restoreDelayMs":500}
//                                                       -> {"pasted":true,"restored":true,"note":""}
//   in   {"cmd":"shutdown"}
//
// Privacy: no key codes or characters ever leave this process. The opt-in debug mode
// (DIKTATORN_HELPER_DEBUG=1) reports modifier-key changes only, never character keys.
//
// Without Input Monitoring the system still lets us create a listen-only tap but silently
// withholds keyboard events from it, so permission is checked explicitly.

import ApplicationServices
import Foundation

let exitPermissionGranted: Int32 = 3
let inserter = Inserter()
let fnState = FnState()
let fnTap = FnTap(state: fnState)
let fnHID = FnHID(state: fnState)

func handle(_ msg: [String: Any]) {
    let id = msg["id"] ?? NSNull()
    let reply: ([String: Any]) -> Void = { result in
        var response = result
        response["id"] = id
        response["ok"] = true
        emit(response)
    }
    switch msg["cmd"] as? String {
    case "shutdown":
        exit(0)
    case "frontmost":
        reply(frontmostApp())
    case "recording":
        fnTap.recording = msg["active"] as? Bool ?? false
        reply([:])
    case "insert":
        guard let text = msg["text"] as? String, !text.isEmpty else {
            emit(["id": id, "ok": false, "error": "missing 'text'"])
            return
        }
        inserter.insert(text: text, restoreDelayMs: msg["restoreDelayMs"] as? Int ?? 500,
                        dryRun: msg["dryRun"] as? Bool ?? false, pasteboardName: msg["pasteboard"] as? String,
                        completion: reply)
    default:
        emit(["id": id, "ok": false, "error": "unknown cmd"])
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
            DispatchQueue.main.async { handle(msg) }  // AppKit and the event tap live on the main thread
        }
        exit(0)  // stdin closed: parent exited
    }
}

setvbuf(stdout, nil, _IOLBF, 0)
readCommands()

// Tests exercise the clipboard without touching the keyboard (or its permission prompt).
if ProcessInfo.processInfo.environment["DIKTATORN_HELPER_NO_KEYS"] != nil {
    emit(["event": "ready", "inputMonitoring": false, "accessibility": inserter.accessibilityTrusted, "keys": false])
    CFRunLoopRun()
}

if !CGPreflightListenEventAccess() {
    _ = CGRequestListenEventAccess()  // shows the system prompt once; afterwards the app is listed, switched off
    emit(["event": "ready", "inputMonitoring": false, "accessibility": inserter.accessibilityTrusted])
    // A tap created now would never receive keys, so wait for the grant and let the parent restart us.
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        guard CGPreflightListenEventAccess() else { return }
        emit(["event": "permission", "inputMonitoring": true])
        exit(exitPermissionGranted)
    }
    CFRunLoopRun()
}

let tapOK = fnTap.start()
let hidOK = fnHID.start()
emit(["event": "ready", "inputMonitoring": true, "accessibility": inserter.accessibilityTrusted, "tap": tapOK,
      "tapActive": fnTap.active, "hid": hidOK])
if !tapOK && !hidOK { emit(["event": "error", "message": "could not open the keyboard (event tap and HID both failed)"]) }
CFRunLoopRun()  // on total failure, stay alive so the parent shows the error; exit on stdin EOF
