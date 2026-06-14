use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=third_party/moonlight-common-c");
    println!("cargo:rerun-if-changed=build.rs");

    let moonlight_base = PathBuf::from("third_party/moonlight-common-c");

    build_enet(&moonlight_base.join("enet"));
    build_moonlight(&moonlight_base);

    #[cfg(windows)]
    {
        println!("cargo:rustc-link-lib=bcrypt");
    }

    tauri_build::build();
}

fn build_enet(enet_dir: &Path) {
    let mut build = cc::Build::new();

    build
        .include(enet_dir.join("include"))
        .flag_if_supported("-w")
        .define("HAS_SOCKLEN_T", None);

    let sources = [
        "callbacks.c",
        "compress.c",
        "host.c",
        "list.c",
        "packet.c",
        "peer.c",
        "protocol.c",
    ];

    for source in &sources {
        build.file(enet_dir.join(source));
    }

    #[cfg(windows)]
    {
        build.file(enet_dir.join("win32.c"));
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=winmm");
    }

    #[cfg(unix)]
    {
        build.file(enet_dir.join("unix.c"));
    }

    build.compile("enet");
}

fn build_moonlight(base_dir: &Path) {
    let src_dir = base_dir.join("src");
    let nanors_dir = base_dir.join("nanors");
    let obl_dir = nanors_dir.join("deps").join("obl");

    let mut build = cc::Build::new();

    build
        .include(&src_dir)
        .include(base_dir.join("enet").join("include"))
        .include(&nanors_dir)
        .include(nanors_dir.join("deps").join("simde"))
        .include(&obl_dir)
        .flag_if_supported("-w")
        .define("LC_STATIC", None);

    let sources = [
        "AudioStream.c",
        "ByteBuffer.c",
        "Connection.c",
        "ConnectionTester.c",
        "ControlStream.c",
        "FakeCallbacks.c",
        "InputStream.c",
        "LinkedBlockingQueue.c",
        "Misc.c",
        "Platform.c",
        "PlatformSockets.c",
        "RecorderCallbacks.c",
        "RtpAudioQueue.c",
        "RtpVideoQueue.c",
        "RtspConnection.c",
        "RtspParser.c",
        "SdpGenerator.c",
        "SimpleStun.c",
        "VideoDepacketizer.c",
        "VideoStream.c",
        "rswrapper.c",
    ];

    for source in &sources {
        build.file(src_dir.join(source));
    }

    build.file(obl_dir.join("oblas_lite.c"));

    build.compile("moonlight_common");
}
