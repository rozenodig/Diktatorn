// diktatorn-asr: local speech recognition process. Keeps whisper models resident and
// answers one request at a time.
//
// Protocol: one JSON object per line. Requests on stdin carry an "id"; every response on
// stdout echoes it with "ok": true/false. Audio is 16 kHz mono 16-bit little-endian PCM,
// base64-encoded in "pcm".
//   {"id":1,"cmd":"load","models":{"sv":"/path/a.bin","en":"/path/b.bin"},"vad":"/path/v.bin"}
//   {"id":2,"cmd":"vad","pcm":"..."}                                   -> {"segments":[[t0,t1],...]} (centiseconds)
//   {"id":3,"cmd":"detect","pcm":"...","model":"en","candidates":["sv","en"]} -> {"probs":{"sv":0.9,"en":0.1}}
//   {"id":4,"cmd":"transcribe","pcm":"...","model":"sv","language":"sv","prompt":""}
//                                                                     -> {"text":"...","segments":[...]}
//   {"cmd":"shutdown"}
// Every successful response includes "ms": wall time spent handling the request.

import Foundation

let debugLogging = ProcessInfo.processInfo.environment["DIKTATORN_ASR_DEBUG"] != nil
whisper_log_set({ _, text, _ in
    if debugLogging, let text { fputs(String(cString: text), stderr) }
}, nil)

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func decodePCM(_ base64: Any?) throws -> [Float] {
    guard let base64 = base64 as? String, let data = Data(base64Encoded: base64) else {
        throw EngineError("missing or invalid 'pcm'")
    }
    guard data.count % 2 == 0 else { throw EngineError("pcm byte length must be even") }
    return data.withUnsafeBytes { raw in
        raw.bindMemory(to: Int16.self).map { Float(Int16(littleEndian: $0)) / 32768 }
    }
}

func string(_ msg: [String: Any], _ key: String) throws -> String {
    guard let value = msg[key] as? String, !value.isEmpty else { throw EngineError("missing '\(key)'") }
    return value
}

let engine = Engine()

func handle(_ msg: [String: Any]) throws -> [String: Any] {
    switch msg["cmd"] as? String {
    case "load":
        guard let models = msg["models"] as? [String: String], !models.isEmpty else {
            throw EngineError("missing 'models'")
        }
        if let threads = msg["threads"] as? Int { engine.threads = Int32(threads) }
        try engine.load(models: models, vadPath: msg["vad"] as? String)
        let start = DispatchTime.now()
        try engine.warmUp()
        return ["models": Array(engine.models.keys).sorted(), "warmUpMs": elapsedMs(since: start),
                "system": String(cString: whisper_print_system_info())]
    case "vad":
        return ["segments": try engine.speechSegments(try decodePCM(msg["pcm"]))]
    case "detect":
        let candidates = msg["candidates"] as? [String] ?? ["sv", "en"]
        let probs = try engine.detectLanguage(try decodePCM(msg["pcm"]), model: try engine.model(try string(msg, "model")),
                                              candidates: candidates)
        return ["probs": probs.mapValues { Double($0) }]
    case "transcribe":
        let segments = try engine.transcribe(
            try decodePCM(msg["pcm"]), model: try engine.model(try string(msg, "model")),
            language: try string(msg, "language"), prompt: msg["prompt"] as? String)
        return [
            "text": segments.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines),
            "segments": segments.map {
                ["t0": $0.t0, "t1": $0.t1, "text": $0.text, "noSpeechProb": Double($0.noSpeechProb)] as [String: Any]
            },
        ]
    case "shutdown":
        exit(0)
    default:
        throw EngineError("unknown cmd")
    }
}

func elapsedMs(since start: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
}

setvbuf(stdout, nil, _IOLBF, 0)
emit(["event": "ready"])
while let line = readLine() {
    let start = DispatchTime.now()
    guard let data = line.data(using: .utf8),
          let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        emit(["ok": false, "error": "unparseable request"])
        continue
    }
    let id = msg["id"] ?? NSNull()
    do {
        var response = try handle(msg)
        response["id"] = id
        response["ok"] = true
        response["ms"] = elapsedMs(since: start)
        emit(response)
    } catch {
        emit(["id": id, "ok": false, "error": "\(error)"])
    }
}
