use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const PROGRESS_EVENT: &str = "summary://progress";

/// 运行中外部进程注册表：run_external 传入 `id` 时登记，kill_external 据此终止。
/// 仅支持单进程级取消（每个 id 一个子进程），进程结束后由 run_external 移除。
static CHILDREN: LazyLock<Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<tokio::process::Child>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 目标三元组（用于 sidecar 命名），与 Tauri externalBin 约定一致。
fn target_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (arch, os) {
        ("x86_64", "macos") => "x86_64-apple-darwin",
        ("aarch64", "macos") => "aarch64-apple-darwin",
        ("x86_64", "windows") => "x86_64-pc-windows-msvc",
        ("aarch64", "windows") => "aarch64-pc-windows-msvc",
        ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
        ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
        (a, o) => return format!("{a}-{o}"),
    }
    .to_string()
}

fn find_in_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{program}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

/// 解析外部二进制：sidecar 资源（非空） → PATH。
/// 外部二进制下载 URL（按程序 + target-triple 映射）。
fn external_binary_url(program: &str, triple: &str) -> Result<String, String> {
    let gh = "https://github.com";
    let url = match (program, triple) {
        ("yt-dlp", "x86_64-apple-darwin" | "aarch64-apple-darwin") =>
            format!("{gh}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"),
        ("yt-dlp", "x86_64-pc-windows-msvc") =>
            format!("{gh}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"),
        ("yt-dlp", _) =>
            format!("{gh}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"),
        ("ffmpeg", "x86_64-apple-darwin" | "aarch64-apple-darwin") =>
            "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip".to_string(),
        ("ffmpeg", "x86_64-pc-windows-msvc") =>
            format!("{gh}/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"),
        ("ffmpeg", _) =>
            format!("{gh}/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz"),
        ("whisper-cli", "x86_64-apple-darwin") =>
            format!("{gh}/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip"),
        ("whisper-cli", "x86_64-pc-windows-msvc") =>
            format!("{gh}/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-Win32.zip"),
        ("whisper-cli", "x86_64-unknown-linux-gnu") =>
            format!("{gh}/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-ubuntu-x64.tar.gz"),
        ("whisper-cli", _) =>
            return Err("whisper-cli 无官方 macOS arm64 预编译，请通过镜像仓库或源码构建提供".to_string()),
        _ => return Err(format!("未知外部程序: {program}")),
    };
    Ok(url)
}

/// 从下载产物中提取目标二进制（zip / tar.xz / 单文件）。
fn extract_binary(tmp: &std::path::Path, program: &str, triple: &str) -> Result<PathBuf, String> {
    let exe_suffix = if triple.ends_with("-windows") { ".exe" } else { "" };
    let names: &[&str] = if program == "whisper-cli" {
        &["whisper-cli", "main"]
    } else {
        &[program]
    };
    let is_target = |p: &std::path::Path| -> bool {
        let file = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let stem = p.file_stem().and_then(|n| n.to_str()).unwrap_or("");
        names.iter().any(|n| *n == file || *n == stem)
            && (exe_suffix.is_empty() || file.ends_with(".exe"))
            && !file.starts_with(".")
    };

    let ext = tmp
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "zip" => {
            let file = std::fs::File::open(tmp).map_err(|e| format!("打开下载包失败: {e}"))?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 zip 失败: {e}"))?;
            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| format!("读取 zip 失败: {e}"))?;
                if entry.is_file() {
                    let name = entry.name().to_string();
                    let p = std::path::Path::new(&name);
                    if is_target(p) {
                        let out = tmp.parent().unwrap_or(std::path::Path::new(".")).join(name);
                        if let Some(parent) = out.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }
                        let mut file = std::fs::File::create(&out).map_err(|e| format!("创建二进制失败: {e}"))?;
                        std::io::copy(&mut entry, &mut file).map_err(|e| format!("写入二进制失败: {e}"))?;
                        return Ok(out);
                    }
                }
            }
            Err("zip 中未找到目标二进制".to_string())
        }
        "xz" => {
            let file = std::fs::File::open(tmp).map_err(|e| format!("打开下载包失败: {e}"))?;
            let decoder = xz2::read::XzDecoder::new(file);
            let mut archive = tar::Archive::new(decoder);
            let entries = archive.entries().map_err(|e| format!("解析 tar.xz 失败: {e}"))?;
            for entry in entries {
                let mut entry = entry.map_err(|e| format!("读取 tar.xz 失败: {e}"))?;
                let p = entry.path().map(|p| p.into_owned()).unwrap_or_default();
                if is_target(&p) {
                    let name = p.to_string_lossy().into_owned();
                    let out = tmp.parent().unwrap_or(std::path::Path::new(".")).join(name);
                    if let Some(parent) = out.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    entry.unpack(&out).map_err(|e| format!("解压二进制失败: {e}"))?;
                    return Ok(out);
                }
            }
            Err("tar.xz 中未找到目标二进制".to_string())
        }
        _ => Ok(tmp.to_path_buf()), // 单文件
    }
}

/// 按需下载外部二进制到应用数据目录（持久，一次下载多次复用）。
#[tauri::command]
pub async fn ensure_external_binary(app: AppHandle, program: String) -> Result<String, String> {
    // macOS 平台的 whisper-cli：官方分发走 Homebrew（brew install whisper-cpp），提供 whisper-cli 到 PATH
    #[cfg(target_os = "macos")]
    if program == "whisper-cli" {
        if let Some(found) = find_in_path("whisper-cli") {
            return Ok(found.to_string_lossy().to_string());
        }
        let status = Command::new("brew")
            .args(["install", "whisper-cpp"])
            .status()
            .await
            .map_err(|e| format!("调用 Homebrew 失败（请确认已安装 brew）: {e}"))?;
        if !status.success() {
            return Err("Homebrew 安装 whisper-cpp 失败，请检查网络或手动安装".to_string());
        }
        return find_in_path("whisper-cli")
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "whisper-cli 安装后未出现在 PATH，请刷新终端后重试".to_string());
    }

    let triple = target_triple();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bin_dir = data_dir.join("binaries");
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("创建二进制目录失败: {e}"))?;
    let exe_suffix = if triple.ends_with("-windows") { ".exe" } else { "" };
    let dest = bin_dir.join(format!("{program}-{triple}{exe_suffix}"));
    let valid = dest.is_file() && dest.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if valid {
        return Ok(dest.to_string_lossy().to_string());
    }

    let url = external_binary_url(&program, &triple)?;
    let tmp = bin_dir.join(format!(".dl-{program}"));
    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载 {program} 失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载 {program} 失败（HTTP {}）", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("读取 {program} 下载失败: {e}"))?;
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("保存 {program} 失败: {e}"))?;

    let extracted = extract_binary(&tmp, &program, &triple).map_err(|e| format!("{program}: {e}"))?;
    std::fs::rename(&extracted, &dest).map_err(|e| format!("移动 {program} 失败: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }

    Ok(dest.to_string_lossy().to_string())
}

/// 解析外部二进制：sidecar 资源 → PATH → 应用数据目录 → 按需下载。
async fn resolve_program(app: &AppHandle, program: &str) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let sidecar = resource_dir
        .join("binaries")
        .join(format!("{program}-{}", target_triple()));
    // 0 字节占位文件视为无效，回退 PATH（开发期未放置真二进制）
    let sidecar_valid = sidecar
        .is_file()
        && sidecar.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if sidecar_valid {
        return Ok(sidecar);
    }
    // dev 模式：externalBin 直接复制到 resource_dir/{program}（无 binaries/ 目录与后缀）
    #[cfg(debug_assertions)]
    {
        let dev_sidecar = resource_dir.join(program);
        let dev_valid = dev_sidecar
            .is_file()
            && dev_sidecar.metadata().map(|m| m.len() > 0).unwrap_or(false);
        if dev_valid {
            return Ok(dev_sidecar);
        }
    }
    if let Some(found) = find_in_path(program) {
        return Ok(found);
    }
    // 按需下载到应用数据目录
    ensure_external_binary(app.clone(), program.to_string())
        .await
        .map(PathBuf::from)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRunResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExternalRequest {
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    /// 进度事件阶段名（如 whisper / render）
    stage: Option<String>,
    /// 任务标识（run_id）：传入后登记进进程注册表，供 kill_external 终止；也随进度事件回传。
    id: Option<String>,
}

/// 通用子进程执行：sidecar/PATH 解析 + stdout/stderr 逐行进度事件。
#[tauri::command]
pub async fn run_external(
    app: AppHandle,
    req: RunExternalRequest,
) -> Result<ExternalRunResult, String> {
    let program_path = resolve_program(&app, &req.program).await?;

    let mut command = Command::new(&program_path);
    command.args(&req.args);
    if let Some(cwd) = &req.cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = &req.env {
        for (key, value) in env {
            command.env(key, value);
        }
    }
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let child = command
        .spawn()
        .map_err(|e| format!("调用 {} 失败，请确认已安装: {e}", req.program))?;

    // 共享句柄：run_external 与 kill_external 通过同一把锁串行访问，避免双重 wait。
    let child_arc = std::sync::Arc::new(tokio::sync::Mutex::new(child));
    if let Some(id) = &req.id {
        CHILDREN.lock().unwrap().insert(id.clone(), child_arc.clone());
    }
    let run_id = req.id.clone().unwrap_or_default();

    let stage = req.stage.clone().unwrap_or_else(|| "external".to_string());
    let stage_stdout = stage.clone();

    let stdout = child_arc.lock().await.stdout.take().expect("stdout piped");
    let stderr = child_arc.lock().await.stderr.take().expect("stderr piped");
    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let run_id_stdout = run_id.clone();
    let run_id_stderr = run_id.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut collected = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        let _ = app_for_stdout.emit(
                            PROGRESS_EVENT,
                            serde_json::json!({
                                "run_id": run_id_stdout,
                                "stage": stage_stdout,
                                "detail": trimmed
                            }),
                        );
                        collected.push_str(&line);
                    }
                }
                Err(_) => break,
            }
        }
        collected
    });
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        let mut collected = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        let _ = app_for_stderr.emit(
                            PROGRESS_EVENT,
                            serde_json::json!({
                                "run_id": run_id_stderr,
                                "stage": stage,
                                "detail": trimmed
                            }),
                        );
                        collected.push_str(&line);
                    }
                }
                Err(_) => break,
            }
        }
        collected
    });

    // 轮询等待退出：kill_external 可能已终止进程，try_wait 返回已退出状态而非双重 wait。
    let status = loop {
        if let Some(status) = child_arc.lock().await.try_wait().map_err(|e| format!("等待进程失败: {e}"))? {
            break status;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    };
    let stdout_text = stdout_task.await.unwrap_or_default();
    let stderr_text = stderr_task.await.unwrap_or_default();

    // 进程已退出，从注册表移除（若 kill_external 已移除则忽略）。
    if let Some(id) = &req.id {
        CHILDREN.lock().unwrap().remove(id);
    }

    Ok(ExternalRunResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: stdout_text,
        stderr: stderr_text,
    })
}

/// 定位 / 下载 Whisper 模型到应用数据目录。
#[tauri::command]
pub async fn ensure_whisper_model(app: AppHandle, model: Option<String>) -> Result<String, String> {
    // 默认 base；仅允许已知模型名，防路径注入
    let model = model.unwrap_or_else(|| "ggml-base.bin".to_string());
    if !model.starts_with("ggml-") || !model.ends_with(".bin") {
        return Err(format!("无效的 Whisper 模型名: {model}"));
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let model_dir = data_dir.join("models");
    std::fs::create_dir_all(&model_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
    let model_path = model_dir.join(&model);
    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{model}");
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载 Whisper 模型失败: {e}"))?;
    if !response.status().is_success() {
        return Err("下载 Whisper 模型失败".to_string());
    }

    let mut file = tokio::fs::File::create(&model_path)
        .await
        .map_err(|e| format!("保存 Whisper 模型失败: {e}"))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取 Whisper 模型失败: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| format!("写入 Whisper 模型失败: {e}"))?;
    }
    file.flush().await.map_err(|e| format!("写入 Whisper 模型失败: {e}"))?;

    Ok(model_path.to_string_lossy().to_string())
}

/// 原生另存为对话框 + 写入内容。
#[tauri::command]
pub async fn save_file(app: AppHandle, suggested_name: String, content: String) -> Result<Option<String>, String> {
    let file_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&suggested_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(path) = file_path {
        let path_buf = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path_buf, content).map_err(|e| format!("写入文件失败: {e}"))?;
        Ok(Some(path_buf.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// 定位 / 创建产物目录（app data output/{run_id}）。
#[tauri::command]
pub async fn resolve_output_dir(app: AppHandle, run_id: String) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("output");
    let dir = base.join(&run_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建产物目录失败: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// 写入文本文件（产物落盘 / cookies.txt）。
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取文本文件（whisper-cli 的 JSON 输出）。
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 判断路径是否为文件（cookie 路径 / wav / mp4 存在性）。
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// 终止运行中的外部进程（按 run_external 登记的任务 id）。
/// 从注册表移除并 kill；已结束/不存在时返回 false。
#[tauri::command]
pub async fn kill_external(id: String) -> Result<bool, String> {
    let child_arc = CHILDREN.lock().unwrap().remove(&id);
    let Some(child_arc) = child_arc else {
        return Ok(false)
    };
    let mut guard = child_arc.lock().await;
    let _ = guard.kill().await;
    Ok(true)
}

/// 确保目录存在（截图 images 子目录等）。
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {e}"))
}

/// 递归删除目录（删除 session 产物用）。文件不存在视为成功。
#[tauri::command]
pub fn remove_dir(path: String) -> Result<(), String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Ok(())
    }
    std::fs::remove_dir_all(dir).map_err(|e| format!("删除目录失败: {e}"))
}

#[cfg(test)]
mod remove_dir_tests {
    use super::remove_dir;
    use std::fs;

    /// 删除包含嵌套目录与文件的整个 session 目录。
    #[test]
    fn removes_nested_session_dir() {
        let dir = std::env::temp_dir().join(format!("rmdir-session-{}", std::process::id()));
        fs::create_dir_all(dir.join("images")).unwrap();
        fs::write(dir.join("summary.md"), "# x").unwrap();
        fs::write(dir.join("images/a.jpg"), "img").unwrap();
        fs::write(dir.join("transcript.txt"), "t").unwrap();

        remove_dir(dir.to_string_lossy().to_string()).unwrap();
        assert!(!dir.exists(), "目录应被整体删除");
    }

    /// 目录不存在时视为成功（幂等）。
    #[test]
    fn missing_dir_is_ok() {
        let dir = std::env::temp_dir().join("definitely-missing-session-xyz");
        remove_dir(dir.to_string_lossy().to_string()).unwrap();
    }
}

#[cfg(test)]
mod external_binary_tests {
    use super::{external_binary_url, extract_binary};
    use std::fs;
    use std::io::Write;

    #[test]
    fn url_mapping_covers_platforms() {
        // yt-dlp 各平台
        assert!(external_binary_url("yt-dlp", "aarch64-apple-darwin").unwrap().contains("yt-dlp_macos"));
        assert!(external_binary_url("yt-dlp", "x86_64-pc-windows-msvc").unwrap().ends_with(".exe"));
        assert!(external_binary_url("yt-dlp", "x86_64-unknown-linux-gnu").unwrap().ends_with("/yt-dlp"));
        // ffmpeg
        assert!(external_binary_url("ffmpeg", "aarch64-apple-darwin").unwrap().contains("evermeet"));
        assert!(external_binary_url("ffmpeg", "x86_64-unknown-linux-gnu").unwrap().contains("linux64"));
        // whisper mac-arm64 无官方 → Err
        assert!(external_binary_url("whisper-cli", "aarch64-apple-darwin").is_err());
        assert!(external_binary_url("whisper-cli", "x86_64-apple-darwin").is_ok());
    }

    #[test]
    fn extract_single_file_passthrough() {
        let dir = std::env::temp_dir().join(format!("extract-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("yt-dlp_macos");
        fs::write(&f, b"binary").unwrap();
        let out = extract_binary(&f, "yt-dlp", "aarch64-apple-darwin").unwrap();
        assert_eq!(out, f);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_from_zip() {
        let dir = std::env::temp_dir().join(format!("extract-zip-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("pkg.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        zw.start_file("bin/whisper-cli", zip::write::SimpleFileOptions::default()).unwrap();
        zw.write_all(b"whisper-binary").unwrap();
        zw.finish().unwrap();

        let out = extract_binary(&zip_path, "whisper-cli", "aarch64-apple-darwin").unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"whisper-binary");
        fs::remove_dir_all(&dir).ok();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    available: bool,
    path: Option<String>,
    error: Option<String>,
}

fn is_valid_bin(path: &std::path::Path) -> bool {
    path.is_file() && path.metadata().map(|m| m.len() > 0).unwrap_or(false)
}

/// 检测外部二进制可用性（不触发下载）：自定义路径 → sidecar → PATH → 应用数据目录。
#[tauri::command]
pub fn check_external_binary(app: AppHandle, program: String, custom_path: Option<String>) -> BinaryStatus {
    let check = |p: &str| -> Option<String> {
        let path = std::path::Path::new(p);
        if is_valid_bin(path) { Some(p.to_string()) } else { None }
    };

    // 1. 自定义路径
    if let Some(p) = custom_path {
        let t = p.trim();
        if !t.is_empty() {
            if let Some(found) = check(t) {
                return BinaryStatus { available: true, path: Some(found), error: None };
            }
            return BinaryStatus { available: false, path: None, error: Some("自定义路径无效".to_string()) };
        }
    }

    // 2. sidecar（打包资源）
    let resource_dir = app.path().resource_dir().ok();
    if let Some(dir) = resource_dir {
        let sidecar = dir.join("binaries").join(format!("{program}-{}", target_triple()));
        if is_valid_bin(&sidecar) {
            return BinaryStatus { available: true, path: Some(sidecar.to_string_lossy().to_string()), error: None };
        }
    }

    // 3. PATH
    if let Some(found) = find_in_path(&program) {
        return BinaryStatus { available: true, path: Some(found.to_string_lossy().to_string()), error: None };
    }

    // 4. 应用数据目录（按需下载缓存）
    if let Ok(data_dir) = app.path().app_data_dir() {
        let exe = if target_triple().ends_with("-windows") { ".exe" } else { "" };
        let cached = data_dir.join("binaries").join(format!("{program}-{}{}", target_triple(), exe));
        if is_valid_bin(&cached) {
            return BinaryStatus { available: true, path: Some(cached.to_string_lossy().to_string()), error: None };
        }
    }

    BinaryStatus { available: false, path: None, error: None }
}

/// 检测 Whisper 模型是否已下载到本地（不触发下载）。
#[tauri::command]
pub fn check_whisper_model(app: AppHandle, model: String) -> Result<bool, String> {
    if !model.starts_with("ggml-") || !model.ends_with(".bin") {
        return Ok(false);
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data_dir.join("models").join(&model);
    Ok(path.is_file() && path.metadata().map(|m| m.len() > 0).unwrap_or(false))
}
