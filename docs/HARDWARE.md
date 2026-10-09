# From phone camera to glasses camera

The intended experience is: look at something through a glasses-mounted camera, ask aloud, and hear an OpenAI reply through an earbud or glasses speaker. The current app prototypes that loop with the phone camera while the page stays open.

## Candidate 1: Seeed Studio XIAO ESP32-S3 Sense

Best candidate here for learning and attaching hardware to existing glasses. The manufacturer documents a programmable camera board, Wi-Fi, battery support, and a camera web-server example. The assembled Sense board is listed as 21 × 17.8 × 15 mm, before a wearable enclosure or battery.

Proposed build, not yet tested: board and camera in a glasses clip, power from a suitable battery or a cable to a pocket power source, video over Wi-Fi to a phone/local bridge, and OpenAI for the conversation. Earbuds or the phone can provide audio.

Additional work includes firmware, mounting, power, networking, and adapting the video source. A local HTTP camera feed cannot simply be substituted into an HTTPS browser's `getUserMedia`: browser security, cross-origin access, and reachability need explicit handling. A cloud Next.js server cannot reach a camera's private LAN address directly. Start on a shared Wi-Fi network, validate the feed and bridge, then design portable networking.

Sources: [Seeed hardware specifications](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/) and [official camera streaming example](https://wiki.seeedstudio.com/xiao_esp32s3_camera_usage/).

## Candidate 2: Meta camera glasses with Device Access Toolkit

Best candidate to investigate for a finished wearable instead of a clip-on build. Meta's iOS Device Access Toolkit exposes camera streaming and photo capture to native apps. The SDK is under active development; verify the supported glasses, firmware, regional availability, permissions, and developer requirements before buying.

Proposed architecture: a native iOS companion receives the glasses camera stream; our OpenAI integration handles conversation; the Next.js project remains useful for the server, settings, and web prototype. This is additional native development, not a camera selection setting in Safari. The hardware SDK does not by itself validate a complete OpenAI integration or guarantee always-on background operation.

Sources: [official iOS SDK](https://github.com/facebook/meta-wearables-dat-ios) and [Meta developer toolkit](https://developers.meta.com/wearables/notify/).

## Linked Amazon camera

The listing for B0HJB4WM85 describes app-based live viewing over its Wi-Fi hotspot. I did not find verified developer access, a documented streaming API, or RTSP in that listing. This does not prove that integration is impossible, but it is insufficient to recommend buying it for this project. Ask for an actual documented stream protocol/API and a sample feed first.

Source: [Amazon listing](https://www.amazon.com/dp/B0HJB4WM85).

## Why not select a tiny action camera just by size?

A camera can record video or preview inside its own app without exposing a live feed to our app. For example, Insta360's GO 3S FAQ says live streaming is not supported, although webcam mode is. That does not establish wireless iPhone integration for this project.

Source: [Insta360 GO 3S FAQ](https://onlinemanual.insta360.com/go3s/en-us/faq/feature/livestream).

## First hardware milestone

Before purchasing a full wearable setup, prove that a chosen camera produces accessible live frames, the phone can receive them while remaining online, and a spoken question gets an answer based on the current view. Measure delay and stability. Only then invest in mounting, batteries, native background support, and a wake-word experience.
