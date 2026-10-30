# Dazzler

Dazzler is an unofficial, minimal desktop wrapper alternative for https://www.deezer.com.

Improvements compared to the official Deezer client:
- You can actually select the language of the interface
- Has a volume slider that you can directly use
- Your own playlist are now placed right below last played in the home screen
- Bigger play buttons with a smoothly animated progress bar
- Does not show a media overlay when playing songs using media keys
- Uses less diskspace (3mb vs 277mb)
- Now without ideological newspeak when in German
- Removes generated playlists with unwanted political messaging from the home screen


> **Unofficial.** This project is not affiliated with, endorsed by or supported by Deezer.
Tested on Windows - Linux and macOS builds are untested.


## Settings
You can find the Dazzler settings under ```Account Settings -> Dazzler```

## Commands

```bash
npm install
npm run dev     # run in development
npm run build   # release build + installers for the current OS in src-tauri/target/release/bundle
```

## Linux

Building needs the Tauri prerequisites (`libwebkit2gtk-4.1-dev` etc., see https://tauri.app/start/prerequisites/).
Playback needs GStreamer plugins (`gstreamer1.0-plugins-good`, `-bad`, `gstreamer1.0-libav`):
the .deb depends on them and the AppImage bundles them.
