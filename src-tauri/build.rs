use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    compile_scripts();
    // The app's own commands, allowed to deezer.com in capabilities/default.json.
    let manifest = tauri_build::AppManifest::new().commands(&["set_background_color"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run tauri-build")
}

/// Compiles the injected scripts (src/**/*.ts) into OUT_DIR/js, where main.rs includes them from.
/// Those in src/inject are a project of their own, joined into OUT_DIR/js/inject.js.
fn compile_scripts() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest_dir.parent().unwrap();
    let tsconfig = root.join("tsconfig.json");
    let inject_tsconfig = manifest_dir.join("src/inject/tsconfig.json");
    let tsc = root.join("node_modules/typescript/bin/tsc");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("js");
    let inject_dir = out_dir.join("inject");

    // A directory is scanned recursively, so added and removed scripts count too.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={}", tsconfig.display());
    println!("cargo:rerun-if-changed={}", tsc.display());

    if !tsc.exists() {
        panic!("TypeScript not found at {}; run `npm install`", tsc.display());
    }
    // Scripts removed since the last build would otherwise still be joined.
    let _ = std::fs::remove_dir_all(&inject_dir);
    run_tsc(&tsc, &tsconfig, &out_dir);
    run_tsc(&tsc, &inject_tsconfig, &inject_dir);
    join_scripts(&inject_dir, &out_dir.join("inject.js"));
}

fn run_tsc(tsc: &Path, tsconfig: &Path, out_dir: &Path) {
    let status = Command::new("node")
        .arg(tsc)
        .arg("--project")
        .arg(tsconfig)
        .arg("--outDir")
        .arg(out_dir)
        .status()
        .expect("failed to run node; is Node.js installed?");
    if !status.success() {
        panic!("compiling the TypeScript scripts failed");
    }
}

/// Joins the scripts in `dir` into one, inside a function, so that what they
/// declare stays out of the page's global scope. main.js, which starts
/// everything, comes last.
fn join_scripts(dir: &Path, out: &Path) {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("reading the compiled scripts failed")
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "js"))
        .collect();
    files.sort_by_key(|path| (path.file_name().is_some_and(|name| name == "main.js"), path.clone()));

    let mut joined = String::from("(() => {\n\"use strict\";\n");
    for file in files {
        let script = std::fs::read_to_string(&file).expect("reading a compiled script failed");
        joined.push_str(script.trim_start_matches("\"use strict\";\n"));
        joined.push('\n');
    }
    joined.push_str("})();\n");
    std::fs::write(out, joined).expect("writing the joined script failed");
}
