export const homeURL = "https://www.nflbite.is/";
export const eventURL = "https://links.nflbite.run/New-York-Jets-vs-Las-Vegas-Raiders/79253";
export const redzoneURL = "https://links.nflbite.run/NFL-Redzone-vs-Live/80079";
export const providerURL = "https://provider.example/watch/jets";
export const embedURL = "https://player.example/embed/jets";
export const streamURL = "https://media.example/live/jets.m3u8?token=fixture&quality=hd";

export function fixturePages() {
  return {
    [homeURL]: { status: 200, body: `
      <nav><a href="/teams/New-York-Jets-live-stream/">Jets</a></nav>
      <a class="text-decoration-none" href="${redzoneURL}">
        <span>Live Now</span><img src="/images/teams/Live.png"><p>Live</p>
        <img src="/images/teams/NFL Redzone.png"><p>NFL Redzone</p>
      </a>
      <a href="${eventURL}"><span>Tomorrow</span>
        <img src="/images/teams/Las Vegas Raiders.png"><p>Las Vegas Raiders</p>
        <img src="/images/teams/New York Jets.png"><p>New York Jets</p>
      </a>
      <a href="${eventURL}">duplicate</a>
      <a href="https://other.example/New-York-Jets-vs-Live/123">not an event</a>
    ` },
    [eventURL]: { status: 200, body: `
      <title>Jets vs Raiders</title><h5>New York Jets</h5><h5>Las Vegas Raiders</h5>
      <script>var sttime = "1793552400";</script>
      <table><tbody><tr>
        <input type="hidden" id="linkk123" value="${providerURL}">
        <td>P</td><td><i></i>Example &amp; Sports</td><td>Platinum</td><td>HD</td><td>English</td>
      </tr><tr><input id="linkk124" value="javascript:alert(1)"><td></td></tr></tbody></table>
      <a href="https://ads.example/">ad</a>
    ` },
    [redzoneURL]: { status: 200, body: `
      <title>NFL Redzone vs Live</title><h5>NFL Redzone</h5><h5>Live</h5>
      <script>var sttime = "1793552400";</script>
    ` },
    [providerURL]: { status: 200, body: `
      <script>throw new Error("remote scripts must never execute");</script>
      <iframe src="https://www.youtube.com/live_chat?v=ad"></iframe>
      <iframe src="${embedURL}"></iframe>
    ` },
    [embedURL]: { status: 200, body: `
      <script>var config = {sources: [{file: "${streamURL.replaceAll("&", "\\u0026")}"}]};</script>
      <video><source src="${streamURL.replaceAll("&", "&amp;")}" type="application/x-mpegURL"></video>
      <iframe src="${providerURL}"></iframe>
    ` },
    [streamURL]: { status: 200, body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6,\nsegment.ts\n" },
  };
}
