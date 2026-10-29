// Never open a console window on Windows, also in debug builds.
#![windows_subsystem = "windows"]

use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{
    AppHandle, CloseRequestApi, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

const DEEZER_URL: &str = "https://www.deezer.com/";
const INJECT_JS: &str = include_str!("inject.js");
const SETTINGS_JS: &str = include_str!("settings.js");

// Passed by the autostart entry, so an autostarted client doesn't take the focus.
const AUTOSTART_ARG: &str = "--autostart";

// Facebook, X, Instagram and TikTok, including their CDNs and tracking endpoints.
#[cfg(windows)]
const BLOCKED_DOMAINS: [&str; 13] = [
    "facebook.com",
    "facebook.net",
    "fbcdn.net",
    "fb.com",
    "instagram.com",
    "cdninstagram.com",
    "twitter.com",
    "twimg.com",
    "x.com",
    "t.co",
    "tiktok.com",
    "tiktokcdn.com",
    "tiktokv.com",
];

// Content scripts to remove gender forms in german
const GZD_SCRIPTS: [&str; 4] = [
    include_str!("gzd/defaults.js"),
    include_str!("gzd/data/lexicon.js"),
    include_str!("gzd/gender-core.js"),
    include_str!("gzd/content.js"),
];

// Deezer may reject WebKitGTK's own user agent as an unsupported browser.
#[cfg(target_os = "linux")]
const LINUX_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/// Forwards a media action ("playpause", "play", "pause", "nexttrack", "previoustrack") to inject.js.
fn send_media_action(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!("window.__dazzler?.media('{action}')"));
    }
}

/// Windows: grab the hardware media keys as global hotkeys.
#[cfg(windows)]
fn media_keys_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::{Code, ShortcutState};

    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let action = match shortcut.key {
                Code::MediaPlayPause => "playpause",
                Code::MediaTrackNext => "nexttrack",
                Code::MediaTrackPrevious => "previoustrack",
                _ => return,
            };
            send_media_action(app, action);
        })
        .build()
}

#[cfg(windows)]
fn setup_media_controls(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

    let keys = [
        Shortcut::new(None, Code::MediaPlayPause),
        Shortcut::new(None, Code::MediaTrackNext),
        Shortcut::new(None, Code::MediaTrackPrevious),
    ];
    // Another app may already own the keys; the player still works without them.
    if let Err(err) = app.global_shortcut().register_multiple(keys) {
        eprintln!("media keys unavailable: {err}");
    }
}

/// Linux (MPRIS) and macOS (Now Playing): register as a media player with the desktop,
/// which then routes media keys and its media widgets to us.
#[cfg(not(windows))]
fn setup_media_controls(app: &AppHandle) {
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig,
    };

    let config = PlatformConfig {
        display_name: "Dazzler",
        dbus_name: "dazzler",
        hwnd: None,
    };
    let mut controls = match MediaControls::new(config) {
        Ok(controls) => controls,
        Err(err) => {
            eprintln!("media controls unavailable: {err:?}");
            return;
        }
    };
    let handle = app.clone();
    let attached = controls.attach(move |event| {
        let action = match event {
            MediaControlEvent::Toggle => "playpause",
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause => "pause",
            MediaControlEvent::Next => "nexttrack",
            MediaControlEvent::Previous => "previoustrack",
            _ => return,
        };
        send_media_action(&handle, action);
    });
    if let Err(err) = attached {
        eprintln!("media controls unavailable: {err:?}");
        return;
    }
    let _ = controls.set_metadata(MediaMetadata {
        title: Some("Dazzler"),
        ..Default::default()
    });
    let _ = controls.set_playback(MediaPlayback::Paused { progress: None });
    // Must stay registered for the app's whole lifetime.
    std::mem::forget(controls);
}

/// Lets inject.js pause playback and save the current queue and position before exiting.
fn close_gracefully(window: &Window, api: &CloseRequestApi) {
    let app = window.app_handle().clone();
    let Some(webview) = app.get_webview_window("main") else {
        return;
    };
    api.prevent_close();
    let _ = webview.eval("window.__dazzler?.beforeClose()");
    let _ = app.save_window_state(StateFlags::all());
    let _ = window.hide();
    // Leaves time for the save to finish; the window is already hidden.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        app.exit(0);
    });
}

const START_URL_FILE: &str = "start-url.txt";

/// deezer.com redirects to a language path (e.g. /de/); starting there skips that round trip.
fn start_url(app: &AppHandle) -> tauri::Url {
    app.path()
        .app_local_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join(START_URL_FILE)).ok())
        .and_then(|url| url.trim().parse().ok())
        .unwrap_or_else(|| DEEZER_URL.parse().expect("valid url"))
}

/// Remembers the language path deezer.com redirected to, for the next start.
fn remember_start_url(app: &AppHandle, loaded: &tauri::Url) {
    if loaded.host_str() != Some("www.deezer.com") {
        return;
    }
    let Some(lang) = loaded.path_segments().and_then(|mut s| s.next()) else {
        return;
    };
    let is_lang =
        (2..=5).contains(&lang.len()) && lang.chars().all(|c| c.is_ascii_lowercase() || c == '-');
    let Ok(dir) = app.path().app_local_data_dir() else {
        return;
    };
    let url = format!("{DEEZER_URL}{lang}/");
    if !is_lang || start_url(app).as_str() == url {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(START_URL_FILE), url);
}

fn main() {
    let builder = tauri::Builder::default()
        // Saves window position/size/maximized on exit; restored manually in setup.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        );
    #[cfg(windows)]
    let builder = builder.plugin(media_keys_plugin());
    // Toggled from the Dazzler tab in Deezer's account settings (settings.js).
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .arg(AUTOSTART_ARG)
            .build(),
    );

    builder
        .setup(|app| {
            let autostarted = std::env::args().any(|arg| arg == AUTOSTART_ARG);
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start_url(app.handle())))
                    .title("Dazzler")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    // Deezer's background, so the window isn't white until the page paints.
                    .background_color(Color(0, 0, 0, 255))
                    .visible(false)
                    // Autostarted, it appears as usual but without taking the focus. Windows
                    // would flash it in the taskbar instead, unless it can't be activated at all.
                    .focused(!autostarted)
                    .focusable(!autostarted)
                    .initialization_script(INJECT_JS)
                    .initialization_script(SETTINGS_JS)
                    .on_page_load(|window, payload| {
                        if payload.event() == PageLoadEvent::Finished {
                            remember_start_url(window.app_handle(), payload.url());
                        }
                    });
            #[cfg(target_os = "linux")]
            {
                builder = builder.user_agent(LINUX_USER_AGENT);
            }
            // WebView2's own media key handling shows the Windows media overlay; our global
            // shortcuts handle the keys instead. They reach the page without a user gesture,
            // so autoplay must be allowed for them to start playback.
            // The first three features are wry's defaults, which this call replaces.
            // Requests to the blocked social networks fail as if their domains didn't exist.
            #[cfg(windows)]
            {
                let blocked = BLOCKED_DOMAINS
                    .iter()
                    .map(|domain| format!("MAP {domain} ~NOTFOUND, MAP *.{domain} ~NOTFOUND"))
                    .collect::<Vec<_>>()
                    .join(", ");
                builder = builder.additional_browser_args(&format!(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling \
                     --autoplay-policy=no-user-gesture-required \
                     --host-resolver-rules=\"{blocked}\"",
                ));
            }
            for script in GZD_SCRIPTS {
                builder = builder.initialization_script(script);
            }
            let window = builder.build()?;
            // Restore before showing so the window doesn't jump from the default placement.
            let _ = window.restore_state(StateFlags::all() - StateFlags::VISIBLE);
            window.show()?;
            if autostarted {
                window.set_focusable(true)?;
            }

            setup_media_controls(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                close_gracefully(window, api);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
