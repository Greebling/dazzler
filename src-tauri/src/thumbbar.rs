//! Windows: previous / play-pause / next buttons in the taskbar's window preview.

use std::sync::OnceLock;

use tauri::{AppHandle, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject, HGDIOBJ};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THB_FLAGS, THB_ICON,
    THB_TOOLTIP, THBF_ENABLED, THBN_CLICKED, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, HICON, ICONINFO, RegisterWindowMessageW, WM_COMMAND,
};
use windows::core::w;

use crate::send_media_action;

// Button id, tooltip, media action and glyph, in display order.
const BUTTONS: [(u32, &str, &str, Glyph); 3] = [
    (0, "Previous", "previoustrack", Glyph::Previous),
    (1, "Play/Pause", "playpause", Glyph::PlayPause),
    (2, "Next", "nexttrack", Glyph::Next),
];

const SUBCLASS_ID: usize = 1;
const ICON_SIZE: usize = 32;

static APP: OnceLock<AppHandle> = OnceLock::new();
static BUTTON_CREATED: OnceLock<u32> = OnceLock::new();

#[derive(Clone, Copy)]
enum Glyph {
    Previous,
    PlayPause,
    Next,
}

type Point = (f32, f32);

fn in_triangle(p: Point, a: Point, b: Point, c: Point) -> bool {
    let side = |p: Point, a: Point, b: Point| (p.0 - b.0) * (a.1 - b.1) - (a.0 - b.0) * (p.1 - b.1);
    let (d1, d2, d3) = (side(p, a, b), side(p, b, c), side(p, c, a));
    !((d1 < 0.0 || d2 < 0.0 || d3 < 0.0) && (d1 > 0.0 || d2 > 0.0 || d3 > 0.0))
}

fn in_bar(p: Point, x0: f32, x1: f32) -> bool {
    (x0..=x1).contains(&p.0) && (8.0..=24.0).contains(&p.1)
}

impl Glyph {
    /// Whether the point (on a 32x32 grid) lies inside the glyph.
    fn contains(self, p: Point) -> bool {
        match self {
            Glyph::Previous => {
                in_bar(p, 7.0, 10.0) || in_triangle(p, (24.0, 8.0), (24.0, 24.0), (11.0, 16.0))
            }
            Glyph::Next => {
                in_bar(p, 22.0, 25.0) || in_triangle(p, (8.0, 8.0), (8.0, 24.0), (21.0, 16.0))
            }
            Glyph::PlayPause => {
                in_triangle(p, (4.0, 8.0), (4.0, 24.0), (16.0, 16.0))
                    || in_bar(p, 19.0, 22.0)
                    || in_bar(p, 25.0, 28.0)
            }
        }
    }

    /// A white, antialiased icon.
    fn icon(self) -> Option<HICON> {
        const SAMPLES: usize = 4;
        let mut bgra = Vec::with_capacity(ICON_SIZE * ICON_SIZE * 4);
        for y in 0..ICON_SIZE {
            for x in 0..ICON_SIZE {
                let mut covered = 0;
                for sy in 0..SAMPLES {
                    for sx in 0..SAMPLES {
                        let p = (
                            x as f32 + (sx as f32 + 0.5) / SAMPLES as f32,
                            y as f32 + (sy as f32 + 0.5) / SAMPLES as f32,
                        );
                        covered += self.contains(p) as usize;
                    }
                }
                // White, so premultiplied alpha leaves every channel equal to the alpha.
                let alpha = (covered * 255 / (SAMPLES * SAMPLES)) as u8;
                bgra.extend_from_slice(&[alpha, alpha, alpha, alpha]);
            }
        }
        let size = ICON_SIZE as i32;
        unsafe {
            let color = CreateBitmap(size, size, 1, 32, Some(bgra.as_ptr().cast()));
            let mask = CreateBitmap(size, size, 1, 1, None);
            let info = ICONINFO {
                fIcon: true.into(),
                xHotspot: 0,
                yHotspot: 0,
                hbmMask: mask,
                hbmColor: color,
            };
            let icon = CreateIconIndirect(&info).ok();
            let _ = DeleteObject(HGDIOBJ(color.0));
            let _ = DeleteObject(HGDIOBJ(mask.0));
            icon
        }
    }
}

fn add_buttons(hwnd: HWND) -> windows::core::Result<()> {
    let buttons: Vec<THUMBBUTTON> = BUTTONS
        .iter()
        .map(|&(id, tip, _, glyph)| {
            let mut button = THUMBBUTTON {
                dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
                iId: id,
                hIcon: glyph.icon().unwrap_or_default(),
                dwFlags: THBF_ENABLED,
                ..Default::default()
            };
            for (dst, src) in button.szTip.iter_mut().zip(tip.encode_utf16()) {
                *dst = src;
            }
            button
        })
        .collect();
    unsafe {
        let list: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
        list.HrInit()?;
        list.ThumbBarAddButtons(hwnd, &buttons)
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if BUTTON_CREATED.get() == Some(&msg) {
        // Sent once the taskbar button exists, and again if Explorer restarts.
        if let Err(err) = add_buttons(hwnd) {
            eprintln!("taskbar media buttons unavailable: {err}");
        }
    } else if msg == WM_COMMAND && (wparam.0 >> 16) as u32 == THBN_CLICKED {
        let id = (wparam.0 & 0xFFFF) as u32;
        if let (Some(app), Some(&(_, _, action, _))) =
            (APP.get(), BUTTONS.iter().find(|button| button.0 == id))
        {
            // Off the window procedure, since the eval waits on the main thread.
            let app = app.clone();
            std::thread::spawn(move || send_media_action(&app, action));
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Call before the window is first shown, so the taskbar button's creation isn't missed.
pub fn setup(app: &AppHandle, window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let _ = APP.set(app.clone());
    let _ = BUTTON_CREATED.set(unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) });
    unsafe {
        let _ = SetWindowSubclass(HWND(hwnd.0), Some(subclass_proc), SUBCLASS_ID, 0);
    }
}
