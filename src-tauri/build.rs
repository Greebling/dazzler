use std::path::PathBuf;
use std::process::Command;

fn main() {
    compile_scripts();
    tauri_build::build()
}

/// Compiles the injected scripts (src/**/*.ts) into OUT_DIR/js, where main.rs includes them from.
fn compile_scripts() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest_dir.parent().unwrap();
    let tsconfig = root.join("tsconfig.json");
    let tsc = root.join("node_modules/typescript/bin/tsc");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("js");

    // A directory is scanned recursively, so added and removed scripts count too.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={}", tsconfig.display());
    println!("cargo:rerun-if-changed={}", tsc.display());

    if !tsc.exists() {
        panic!("TypeScript not found at {}; run `npm install`", tsc.display());
    }
    let status = Command::new("node")
        .arg(&tsc)
        .arg("--project")
        .arg(&tsconfig)
        .arg("--outDir")
        .arg(&out_dir)
        .status()
        .expect("failed to run node; is Node.js installed?");
    if !status.success() {
        panic!("compiling the TypeScript scripts failed");
    }
}
