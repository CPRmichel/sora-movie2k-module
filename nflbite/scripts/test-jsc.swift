import Foundation
import JavaScriptCore

guard CommandLine.arguments.count == 3, let context = JSContext() else {
    fatalError("Usage: swift test-jsc.swift module.js fixtures.json")
}
var failed = false
var finished = false
context.exceptionHandler = { _, exception in
    fputs("JavaScriptCore exception: \(exception?.toString() ?? "unknown")\n", stderr)
    failed = true
}

// Match Luna's UTF-8 atob behavior, including nil for invalid binary UTF-8.
let atob: @convention(block) (String) -> String? = { value in
    guard let data = Data(base64Encoded: value) else { return nil }
    return String(data: data, encoding: .utf8)
}
context.setObject(atob, forKeyedSubscript: "atob" as NSString)
let done: @convention(block) (String) -> Void = { result in
    print(result)
    failed = failed || !result.hasPrefix("PASS:")
    finished = true
}
context.setObject(done, forKeyedSubscript: "nativeDone" as NSString)
let fixtures = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
context.evaluateScript("""
var fixtures = \(fixtures);
var console = {log: function() {}};
function fetchv2(url, headers) {
    var item = fixtures[url] || {status: 404, body: "Not found"};
    return Promise.resolve({status: item.status, text: function() {return Promise.resolve(item.body);}});
}
""")
let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
context.evaluateScript(source, withSourceURL: URL(fileURLWithPath: CommandLine.arguments[1]))
if !failed {
    context.evaluateScript("""
    (async function() {
        function check(value, message) { if (!value) throw new Error(message); }
        var events = JSON.parse(await searchResults("NFL"));
        check(events.length === 2, "schedule");
        var redzone = JSON.parse(await searchResults("NFL Red Zone"));
        check(redzone.length === 1 && redzone[0].title === "NFL RedZone", "RedZone aliases");
        var match = JSON.parse(await searchResults("jets"))[0];
        check(match.title === "New York Jets vs. Las Vegas Raiders", "search");
        var details = JSON.parse(await extractDetails(match.href));
        check(details[0].airdate === "2026-11-01T17:00:00.000Z", "details");
        var episodes = JSON.parse(await extractEpisodes(match.href));
        check(episodes[0].number === 1, "episodes");
        var sources = JSON.parse(await extractStreamUrl(match.href));
        check(sources.streams.length === 1, "streams");
        check(sources.streams[0].streamUrl === sources.streams[0].url, "stream URL aliases");
        check(sources.streams[0].headers.Referer === "https://player.example/embed/jets", "headers");
        nativeDone("PASS: Apple JavaScriptCore, Luna-compatible globals, schedule, search, details, live episode, stream and headers");
    })().catch(function(error) {nativeDone("FAIL: " + error.message);});
    """)
}
let deadline = Date().addingTimeInterval(10)
while !failed && !finished && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.01))
}
if !finished { fputs("JavaScriptCore test did not complete\n", stderr) }
exit(failed || !finished ? 1 : 0)
