# Deezer Client (Unofficial)

A minimal Tauri v2 desktop wrapper for https://www.deezer.com.

Improvements compared to the official client:
- You can actually select the language of the interface
- Does not show a media overlay when playing songs using media keys
- Uses way less diskspace (3mb vs ~300mb)
- Now without ideological newspeak when in German


> **Unofficial.** This project is not affiliated with, endorsed by or supported by Deezer.
Tested on Windows - Linux and macOS builds are untested.

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

## License

Copyright (C) 2026 Greebling

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License Version 3 as published by the Free Software Foundation. See [LICENSE](LICENSE).
