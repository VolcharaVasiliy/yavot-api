# Supported sites

This document lists the video platforms that **yavot-api** (via
[`@vot.js`](https://github.com/FOSWLY/vot.js)) can resolve **automatically** from a plain
page URL. For every site below, you only need to pass the page/video link to `POST /translate`
— the library's built-in site helpers extract the direct media stream for Yandex.

> **YouTube** and any direct `.mp4` / `.webm` link work out of the box (no helper needed).
> **Any other site** can still be translated by passing a `directUrl` (see README).

### Universal coverage via the ytdlp.online resolver

With `YTDLP_ONLINE=1` set (see README), **every site that
[yt-dlp](https://github.com/yt-dlp/yt-dlp) supports** is translatable from a bare page URL —
no `directUrl` required. The API reverse-engineered `ytdlp.online` (`/api/v1/stream`) to extract
a re-hosted media URL that Yandex fetches directly. This effectively extends coverage to the
entire yt-dlp ecosystem (thousands of sites), on top of the ~80 native helpers listed below.

## Natively supported (dedicated helpers)

- **appledeveloper** — https://developer.apple.com/
- **archive** — https://archive.org/details/
- **artstation** — https://www.artstation.com/learning/
- **bannedvideo** — https://madmaxworld.tv/watch?id=
- **bilibili** — https://www.bilibili.com/
- **bitchute** — https://www.bitchute.com/video/
- **bitview** — https://www.bitview.net/watch?v=
- **bunkr** — https://bunkr.site/
- **bunnystream** — (bunnystream)
- **cloudflarestream** — (cloudflarestream)
- **coursehunterLike** — (coursehunterLike)
- **coursera** — https://www.coursera.org/
- **dailymotion** — https://www.dailymotion.com/video/
- **datacamp** — https://www.datacamp.com/courses/
- **deeplearningai** — https://learn.deeplearning.ai/courses/
- **douyin** — https://www.douyin.com/
- **dzen** — https://dzen.ru/video/watch/
- **egghead** — https://egghead.io/
- **epicgames** — https://dev.epicgames.com/community/learning/
- **eporner** — https://www.eporner.com/
- **facebook** — https://facebook.com/
- **googledrive** — https://drive.google.com/file/d/
- **ign** — https://de.ign.com/
- **imdb** — https://www.imdb.com/video/
- **invidious** — https://youtu.be/
- **jove** — https://jove.com/
- **kick** — https://kick.com/
- **kickstarter** — https://www.kickstarter.com/
- **kodik** — (kodik)
- **linkedin** — https://www.linkedin.com/learning/
- **loom** — https://www.loom.com/share/
- **mailru** — https://my.mail.ru/
- **mediafile** — https://mediafile.cc/
- **netacad** — https://www.netacad.com/
- **newgrounds** — https://www.newgrounds.com/
- **niconico** — https://www.nicovideo.jp/watch/
- **nine_gag** — https://9gag.com/gag/
- **noodlemagazine** — https://hot.noodlemagazine.com/
- **odysee** — (odysee)
- **okru** — https://ok.ru/video/
- **olympicsreplay** — https://olympics.com/
- **oraclelearn** — https://mylearn.oracle.com/ou/course/
- **patreon** — (patreon)
- **peertube** — (peertube)
- **picarto** — https://picarto.tv/
- **piped** — https://youtu.be/
- **pornhub** — https://rt.pornhub.com/view_video.php?viewkey=
- **porntn** — https://porntn.com/videos/
- **preservetube** — https://preservetube.com/
- **proxitok** — https://www.tiktok.com/
- **reddit** — (reddit)
- **rtnews** — https://www.rt.com/
- **rule34video** — https://rule34video.com/video/
- **rumble** — https://rumble.com/
- **rutube** — https://rutube.ru/video/
- **sap** — https://learning.sap.com/courses/
- **skilljar** — https://anthropic.skilljar.com/
- **spankbang** — https://spankbang.com/
- **telegram** — https://t.me/
- **thisvid** — https://thisvid.com/
- **tiktok** — https://www.tiktok.com/
- **trovo** — https://trovo.live/s/
- **twitch** — https://twitch.tv/
- **twitter** — https://twitter.com/i/status/
- **udemy** — https://www.udemy.com/
- **vimeo** — https://vimeo.com/
- **vk** — https://vk.com/
- **watchpornto** — https://watchporn.to/
- **weibo** — https://weibo.com/
- **weverse** — https://weverse.io/
- **wistia** — https://fast.wistia.net/embed/iframe/
- **xhamster** — https://xhamster.com/
- **xvideos** — https://www.xvideos.com/
- **yandexdisk** — https://yadi.sk/
- **youku** — https://v.youku.com/
- **youtube** — https://youtu.be/
- **zdf** — https://www.zdf.de/play/

## Everything else (yt-dlp backed)

In addition to the list above, the underlying project relies on
[**yt-dlp**](https://github.com/yt-dlp/yt-dlp) extractors. That means **any site yt-dlp can
handle** is translatable once you supply its direct media URL (via `directUrl` /
`translationHelp`). The full, continuously-updated list of yt-dlp supported sites is here:

- https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md (~1000+ sites)

A future version of this API may run yt-dlp server-side so that a bare page URL for *any*
yt-dlp site works automatically.

## Notes

- Some sites require you to be **logged in** (e.g. Coursera, LinkedIn Learning, Udemy) for the
  helper to read the video — the API will still need the video to be publicly reachable.
- "Lively voice" (neural cloning) is independent of the source site and needs Yandex auth.
